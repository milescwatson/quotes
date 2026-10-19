<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import HardBreak from '@tiptap/extension-hard-break'
import { UndoRedo } from '@tiptap/extensions'
import { descriptionDocument, documentRuns, type DescriptionRun } from '~/utils/description'
const props = defineProps<{ modelValue: DescriptionRun[]; disabled: boolean; inputId: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: DescriptionRun[]] }>()
const editor = useEditor({
  extensions: [Document, Paragraph, Text, Bold, Italic, Underline, UndoRedo, HardBreak.extend({ addKeyboardShortcuts() { return { Enter: () => this.editor.commands.setHardBreak(), 'Shift-Enter': () => this.editor.commands.setHardBreak(), 'Mod-Enter': () => this.editor.commands.setHardBreak() } } })],
  content: descriptionDocument(props.modelValue),
  editable: !props.disabled,
  editorProps: { attributes: { id: props.inputId, role: 'textbox', 'aria-label': 'Description', 'aria-multiline': 'true', class: 'min-h-20 whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none' } },
  onUpdate: ({ editor }) => emit('update:modelValue', documentRuns(editor.getJSON())),
})
const length = computed(() => props.modelValue.reduce((sum, run) => sum + run.text.length, 0))
watch(() => props.disabled, disabled => editor.value?.setEditable(!disabled, false))
watch(() => props.modelValue, value => {
  if (editor.value && JSON.stringify(documentRuns(editor.value.getJSON())) !== JSON.stringify(value)) editor.value.commands.setContent(descriptionDocument(value), { emitUpdate: false })
}, { deep: true })
</script>
<template>
  <div class="my-3 min-w-0">
    <label :for="inputId" class="mb-1 text-xs font-medium text-gray-500">Description</label>
    <div class="overflow-hidden rounded-md border bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500" :class="length > 5000 ? 'border-red-500' : 'border-gray-200'">
      <div class="flex gap-1 border-b border-gray-100 px-2 py-1" role="group" aria-label="Description formatting">
        <button v-for="mark in (['bold', 'italic', 'underline'] as const)" :key="mark" type="button" class="min-h-8 min-w-8 rounded text-sm hover:bg-gray-100" :class="[{ 'bg-blue-50 text-blue-700': editor?.isActive(mark) }, mark === 'bold' ? 'font-bold' : mark === 'italic' ? 'italic' : 'underline']" :aria-label="mark[0]!.toUpperCase() + mark.slice(1)" :aria-pressed="editor?.isActive(mark) ?? false" :disabled="disabled || !editor" @mousedown.prevent @click="editor?.chain().focus().toggleMark(mark).run()">{{ mark === 'bold' ? 'B' : mark === 'italic' ? 'I' : 'U' }}</button>
      </div>
      <EditorContent :editor="editor" />
    </div>
    <p v-if="length > 5000" class="error text-xs" role="alert">Use at most 5,000 description characters.</p>
  </div>
</template>
