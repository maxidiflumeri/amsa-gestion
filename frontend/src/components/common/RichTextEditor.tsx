import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Heading from '@tiptap/extension-heading'
import { Box, IconButton, Divider, Tooltip, Select, MenuItem, ToggleButton, ToggleButtonGroup } from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight'

interface Props {
    value: string
    onChange: (html: string) => void
    readOnly?: boolean
    minHeight?: number
}

const COLORS = [
    { label: 'Negro', value: '#000000' },
    { label: 'Gris', value: '#666666' },
    { label: 'Rojo', value: '#e53935' },
    { label: 'Naranja', value: '#fb8c00' },
    { label: 'Verde', value: '#43a047' },
    { label: 'Azul', value: '#1e88e5' },
    { label: 'Violeta', value: '#8e24aa' },
]

const RichTextEditor: React.FC<Props> = ({ value, onChange, readOnly = false, minHeight = 200 }) => {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: false }),
            Heading.configure({ levels: [1, 2, 3] }),
            Underline,
            TextStyle,
            Color,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
        ],
        content: value,
        editable: !readOnly,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML())
        },
    }, [readOnly])

    // Sync content when value prop changes externally (e.g. switching between políticas)
    React.useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            editor.commands.setContent(value || '')
        }
    }, [value, editor])

    if (!editor) return null

    return (
        <Box
            sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
            }}
        >
            {/* Toolbar — solo en modo edición */}
            {!readOnly && (
                <Box
                    sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1,
                        py: 0.5,
                        bgcolor: 'action.hover',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    {/* Nivel de texto */}
                    <Select
                        size="small"
                        value={
                            editor.isActive('heading', { level: 1 }) ? '1'
                            : editor.isActive('heading', { level: 2 }) ? '2'
                            : editor.isActive('heading', { level: 3 }) ? '3'
                            : '0'
                        }
                        onChange={e => {
                            const val = e.target.value
                            if (val === '0') editor.chain().focus().setParagraph().run()
                            else editor.chain().focus().toggleHeading({ level: Number(val) as 1|2|3 }).run()
                        }}
                        sx={{ fontSize: '0.75rem', height: 30, minWidth: 110 }}
                    >
                        <MenuItem value="0">Párrafo</MenuItem>
                        <MenuItem value="1">Título 1</MenuItem>
                        <MenuItem value="2">Título 2</MenuItem>
                        <MenuItem value="3">Título 3</MenuItem>
                    </Select>

                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

                    {/* Formato */}
                    <Tooltip title="Negrita">
                        <IconButton size="small" onClick={() => editor.chain().focus().toggleBold().run()}
                            color={editor.isActive('bold') ? 'primary' : 'default'}>
                            <FormatBoldIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Cursiva">
                        <IconButton size="small" onClick={() => editor.chain().focus().toggleItalic().run()}
                            color={editor.isActive('italic') ? 'primary' : 'default'}>
                            <FormatItalicIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Subrayado">
                        <IconButton size="small" onClick={() => editor.chain().focus().toggleUnderline().run()}
                            color={editor.isActive('underline') ? 'primary' : 'default'}>
                            <FormatUnderlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

                    {/* Listas */}
                    <Tooltip title="Lista con viñetas">
                        <IconButton size="small" onClick={() => editor.chain().focus().toggleBulletList().run()}
                            color={editor.isActive('bulletList') ? 'primary' : 'default'}>
                            <FormatListBulletedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Lista numerada">
                        <IconButton size="small" onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            color={editor.isActive('orderedList') ? 'primary' : 'default'}>
                            <FormatListNumberedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

                    {/* Alineación */}
                    <Tooltip title="Izquierda">
                        <IconButton size="small" onClick={() => editor.chain().focus().setTextAlign('left').run()}
                            color={editor.isActive({ textAlign: 'left' }) ? 'primary' : 'default'}>
                            <FormatAlignLeftIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Centro">
                        <IconButton size="small" onClick={() => editor.chain().focus().setTextAlign('center').run()}
                            color={editor.isActive({ textAlign: 'center' }) ? 'primary' : 'default'}>
                            <FormatAlignCenterIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Derecha">
                        <IconButton size="small" onClick={() => editor.chain().focus().setTextAlign('right').run()}
                            color={editor.isActive({ textAlign: 'right' }) ? 'primary' : 'default'}>
                            <FormatAlignRightIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

                    {/* Color de texto */}
                    {COLORS.map(c => (
                        <Tooltip key={c.value} title={c.label}>
                            <IconButton
                                size="small"
                                onClick={() => editor.chain().focus().setColor(c.value).run()}
                                sx={{
                                    width: 22,
                                    height: 22,
                                    bgcolor: c.value,
                                    border: editor.isActive('textStyle', { color: c.value }) ? '2px solid white' : '2px solid transparent',
                                    '&:hover': { bgcolor: c.value, opacity: 0.8 },
                                }}
                            />
                        </Tooltip>
                    ))}
                </Box>
            )}

            {/* Área de contenido */}
            <Box
                sx={{
                    minHeight,
                    px: 2,
                    py: 1.5,
                    '& .tiptap': {
                        outline: 'none',
                        minHeight,
                        '& h1': { fontSize: '1.6rem', fontWeight: 700, mt: 1, mb: 0.5 },
                        '& h2': { fontSize: '1.3rem', fontWeight: 700, mt: 1, mb: 0.5 },
                        '& h3': { fontSize: '1.1rem', fontWeight: 700, mt: 1, mb: 0.5 },
                        '& p': { margin: '0.3em 0' },
                        '& ul, & ol': { pl: 3 },
                        '& li': { mb: 0.25 },
                    },
                }}
            >
                <EditorContent editor={editor} />
            </Box>
        </Box>
    )
}

export default RichTextEditor
