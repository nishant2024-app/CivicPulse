{{/* Labels shared by every workload. Call with (dict "name" "<component>" "root" .) */}}
{{- define "cp.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: civicpulse
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{- define "cp.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/* Pod security: no privilege escalation, no capabilities, default seccomp. */}}
{{- define "cp.containerSecurity" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
{{- end -}}
