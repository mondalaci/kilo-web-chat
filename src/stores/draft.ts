import { ref } from "vue"

export interface Attachment {
  id: string
  mime: string
  /** Data URL (base64) sent as the file part `url`. */
  url: string
  filename: string
}

/** Shared composer draft so empty-state suggestions can prefill the input. */
export const draft = ref("")

/** Images pasted or dropped into the composer, sent as file parts. */
export const attachments = ref<Attachment[]>([])

let counter = 0
function nextId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `att-${Date.now()}-${counter++}`
}

export async function addImageFile(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null
  const url = await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
  if (!url) return null
  const extension = (file.type.split("/")[1] || "png").replace("+xml", "")
  const attachment: Attachment = {
    id: nextId(),
    mime: file.type,
    url,
    filename: file.name && file.name !== "image.png" ? file.name : `pasted-image-${Date.now()}.${extension}`,
  }
  attachments.value = [...attachments.value, attachment]
  return attachment
}

export function removeAttachment(id: string) {
  attachments.value = attachments.value.filter((item) => item.id !== id)
}

export function clearAttachments() {
  attachments.value = []
}

export function useDraft() {
  return { draft, attachments }
}