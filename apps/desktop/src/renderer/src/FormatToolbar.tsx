import { useEffect, useReducer } from 'react'
import type { Editor } from '@tiptap/react'
import { CheckSquareIcon, ImageIcon } from './icons'

interface ToolButton {
  label: React.ReactNode
  title: string
  isOn: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

const TOOLS: ToolButton[] = [
  {
    label: 'B',
    title: 'Bold (⌘B)',
    isOn: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run()
  },
  {
    label: 'I',
    title: 'Italic (⌘I)',
    isOn: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run()
  },
  {
    label: 'S',
    title: 'Strikethrough',
    isOn: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run()
  },
  {
    label: 'H1',
    title: 'Heading',
    isOn: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    label: 'H2',
    title: 'Subheading',
    isOn: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    label: '•',
    title: 'Bullet list',
    isOn: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run()
  },
  {
    label: '1.',
    title: 'Numbered list',
    isOn: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run()
  },
  {
    label: <CheckSquareIcon size={13} />,
    title: 'To-do list',
    isOn: (e) => e.isActive('taskList'),
    run: (e) => e.chain().focus().toggleTaskList().run()
  },
  {
    label: '❝',
    title: 'Quote',
    isOn: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run()
  },
  {
    label: '</>',
    title: 'Code block',
    isOn: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run()
  }
]

/** Slim formatting bar above the notes editor; also hosts the image picker. */
export default function FormatToolbar({
  editor,
  onPickImage
}: {
  editor: Editor | null
  onPickImage: () => void
}): React.JSX.Element | null {
  // Active states live inside the editor; re-render on every transaction.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="fmt-toolbar" role="toolbar" aria-label="Text formatting">
      {TOOLS.map((tool) => (
        <button
          key={tool.title}
          type="button"
          className={tool.isOn(editor) ? 'fmt-btn on' : 'fmt-btn'}
          title={tool.title}
          aria-label={tool.title}
          aria-pressed={tool.isOn(editor)}
          onMouseDown={(e) => e.preventDefault() /* keep editor selection */}
          onClick={() => tool.run(editor)}
        >
          {tool.label}
        </button>
      ))}
      <span className="fmt-sep" aria-hidden="true" />
      <button
        type="button"
        className="fmt-btn"
        title="Insert image (or paste / drag one in)"
        aria-label="Insert image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPickImage}
      >
        <ImageIcon size={13} />
      </button>
    </div>
  )
}
