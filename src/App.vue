<script setup lang="ts">
import { onMounted } from "vue"
import ChatShell from "./components/ChatShell.vue"
import InstancePicker from "./components/InstancePicker.vue"
import { useApp } from "@/stores/app"

const app = useApp()
const connected = app.connection.connected

onMounted(async () => {
  if (connected.value) return
  await app.connection.scan()

  // Reconnect to the most recently used server when it is reachable and we
  // either already hold credentials or it needs none.
  const saved = [...app.connection.saved.value].sort((a, b) => b.lastUsed - a.lastUsed)
  const last = saved[0]
  if (!last) return
  const info = app.connection.instances.value.find((item) => item.origin === last.origin)
  if (!info) return
  if (info.requiresAuth && !last.password) return
  await app.connect(info, app.connection.credentialsFor(last.origin))
})
</script>

<template>
  <InstancePicker v-if="!connected" />
  <ChatShell v-else />
</template>