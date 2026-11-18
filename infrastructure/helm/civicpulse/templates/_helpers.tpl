{{- define "cp.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: civicpulse
app.kubernetes.io/version: {{ .root.Values.image.tag | default .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{- define "cp.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "cp.image" -}}
{{ .root.Values.image.prefix }}-{{ .name }}:{{ .root.Values.image.tag | default .root.Chart.AppVersion }}
{{- end -}}

{{/* Environment shared by the API, the workers and the one-off jobs. */}}
{{- define "cp.env" -}}
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: database-url } }
- name: SESSION_SECRET
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: session-secret } }
- name: S3_ACCESS_KEY_ID
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: s3-access-key-id } }
- name: S3_SECRET_ACCESS_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: s3-secret-access-key } }
{{- end -}}

{{- define "cp.podSecurity" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "cp.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: ["ALL"] }
{{- end -}}
