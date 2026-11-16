"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Notification, Pagination } from "@civicpulse/shared";
import { PageHeader, Pager } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { cn, fromNow } from "@/lib/utils";

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const notifications = useQuery({
    queryKey: ["notifications", "list", page],
    queryFn: () =>
      api.get<{ data: Notification[]; pagination: Pagination }>(
        `/notifications?page=${page}&pageSize=20`,
      ),
    placeholderData: keepPreviousData,
    // Notifications are produced asynchronously; keep the open page current.
    refetchInterval: 10_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: refresh,
  });
  const open = useMutation({
    mutationFn: async (notification: Notification) => {
      if (!notification.readAt) await api.post(`/notifications/${notification.id}/read`);
      return notification;
    },
    onSuccess: (notification) => {
      void refresh();
      if (notification.complaintId) router.push(`/complaints/${notification.complaintId}`);
    },
  });
  const hasUnread = notifications.data?.data.some((notification) => !notification.readAt);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates on reports you filed or are responsible for."
        action={
          hasUnread ? (
            <Button variant="outline" loading={readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all as read
            </Button>
          ) : null
        }
      />
      <Card>
        {notifications.isPending ? (
          <CardBody className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardBody>
        ) : notifications.isError ? (
          <ErrorState
            message={errorMessage(notifications.error)}
            onRetry={() => void notifications.refetch()}
          />
        ) : notifications.data.data.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nothing yet"
            description="You will hear here when a report you are involved in changes status."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {notifications.data.data.map((notification) => (
                <li key={notification.id}>
                  <button
                    className={cn(
                      "flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-canvas",
                      !notification.readAt && "bg-brand-50/60",
                    )}
                    onClick={() => open.mutate(notification)}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0",
                        notification.readAt ? "bg-transparent" : "bg-signal",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <span
                          className={cn(
                            "text-ink",
                            notification.readAt ? "font-medium" : "font-bold",
                          )}
                        >
                          {notification.title}
                          {!notification.readAt ? <span className="sr-only"> (unread)</span> : null}
                        </span>
                        <time
                          className="font-mono text-xs text-muted"
                          dateTime={notification.createdAt}
                        >
                          {fromNow(notification.createdAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {notification.body}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager
              page={notifications.data.pagination.page}
              totalPages={notifications.data.pagination.totalPages}
              total={notifications.data.pagination.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
