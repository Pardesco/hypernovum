import React, { useRef, useEffect, useState, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Cyberpunk dark theme
const cyberpunkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff79c6' },
  { tag: tags.operator, color: '#ff79c6' },
  { tag: tags.string, color: '#f1fa8c' },
  { tag: tags.number, color: '#bd93f9' },
  { tag: tags.bool, color: '#bd93f9' },
  { tag: tags.null, color: '#bd93f9' },
  { tag: tags.comment, color: '#6272a4', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#50fa7b' },
  { tag: tags.function(tags.variableName), color: '#50fa7b' },
  { tag: tags.definition(tags.variableName), color: '#50fa7b' },
  { tag: tags.typeName, color: '#8be9fd', fontStyle: 'italic' },
  { tag: tags.className, color: '#8be9fd' },
  { tag: tags.propertyName, color: '#66d9ef' },
  { tag: tags.heading, color: '#b366ff', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#f8f8f2' },
  { tag: tags.strong, fontWeight: 'bold', color: '#f8f8f2' },
  { tag: tags.link, color: '#8be9fd', textDecoration: 'underline' },
  { tag: tags.url, color: '#8be9fd' },
  { tag: tags.meta, color: '#ff79c6' },
  { tag: tags.tagName, color: '#ff79c6' },
  { tag: tags.attributeName, color: '#50fa7b' },
  { tag: tags.attributeValue, color: '#f1fa8c' },
]);

const cyberpunkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: '#f8f8f2',
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
    fontSize: '13px',
    height: '100%',
  },
  '.cm-content': {
    caretColor: '#b366ff',
    padding: '8px 0',
  },
  '.cm-cursor': {
    borderLeftColor: '#b366ff',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(179, 102, 255, 0.08)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(179, 102, 255, 0.12)',
  },
  '.cm-gutters': {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    color: 'rgba(150, 150, 180, 0.5)',
    border: 'none',
    borderRight: '1px solid rgba(100, 100, 140, 0.15)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '3ch',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(179, 102, 255, 0.25) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(179, 102, 255, 0.3) !important',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(179, 102, 255, 0.3)',
    outline: '1px solid rgba(179, 102, 255, 0.5)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: true });

function getLanguageExtension(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js': case 'jsx': case 'mjs':
      return javascript({ jsx: true });
    case 'ts': case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'py':
      return python();
    case 'rs':
      return rust();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'html': case 'htm': case 'svelte': case 'vue':
      return html();
    case 'md': case 'mdx':
    default:
      return markdown();
  }
}

interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

interface Props {
  projectDir: string | null;
  projectTitle: string;
  onClose: () => void;
  onTyping?: () => void;
}

export function HolodeckPanel({ projectDir, projectTitle, onClose, onTyping }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFileRef = useRef<string | null>(null);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  // Track activeFile in a ref so the save keymap closure always has the latest
  activeFileRef.current = activeFile;

  // Load file tree when project changes
  useEffect(() => {
    if (!projectDir) return;
    setActiveFile(null);
    setFileContent(null);
    setFiles([]);
    window.hypervault.listFiles(projectDir).then(setFiles);
  }, [projectDir]);

  // Read file content (state only, no DOM manipulation)
  const loadFile = useCallback(async (filePath: string) => {
    const result = await window.hypervault.readFile(filePath);
    if (!result.ok || result.content === undefined) {
      console.error('Failed to read file:', filePath, result.error);
      return;
    }
    setActiveFile(filePath);
    setFileContent(result.content);
    setDirty(false);
  }, []);

  // Create CodeMirror editor AFTER React has rendered
  useEffect(() => {
    if (!activeFile || fileContent === null || !editorRef.current) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    try {
      const saveKeymap = keymap.of([{
        key: 'Mod-s',
        run: () => {
          const fp = activeFileRef.current;
          if (fp && viewRef.current) {
            const content = viewRef.current.state.doc.toString();
            setSaving(true);
            window.hypervault.writeFile(fp, content).then(() => {
              setDirty(false);
              setSaving(false);
            });
          }
          return true;
        },
      }]);

      const state = EditorState.create({
        doc: fileContent,
        extensions: [
          cyberpunkTheme,
          syntaxHighlighting(cyberpunkHighlight),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          saveKeymap,
          getLanguageExtension(activeFile),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setDirty(true);
              onTypingRef.current?.();

              // Debounced auto-save (1s after stop typing)
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => {
                const fp = activeFileRef.current;
                if (fp && viewRef.current) {
                  const content = viewRef.current.state.doc.toString();
                  window.hypervault.writeFile(fp, content).then(() => {
                    setDirty(false);
                  });
                }
              }, 1000);
            }
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: editorRef.current,
      });

      viewRef.current = view;
      view.focus();
    } catch (err) {
      console.error('Failed to create CodeMirror editor:', err);
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [activeFile, fileContent]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Escape key closes editor (when not focused in CodeMirror)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!projectDir) return null;

  // Build a simple flat file list grouped by directory
  const editableExts = new Set([
    'md', 'mdx', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'css',
    'html', 'htm', 'py', 'rs', 'go', 'java', 'kt', 'toml', 'yaml', 'yml',
    'sh', 'bat', 'ps1', 'cfg', 'ini', 'env', 'gitignore', 'svelte', 'vue',
    'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'lua', 'vert', 'frag', 'glsl',
  ]);

  const editableFiles = files.filter(f => {
    if (f.isDir) return false;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    return editableExts.has(ext) || f.name.startsWith('.');
  });

  return (
    <div className="holodeck-panel">
      {/* Header */}
      <div className="holodeck-header">
        <div className="holodeck-title">
          <span className="holodeck-bracket">[</span>
          {projectTitle}
          <span className="holodeck-bracket">]</span>
          {dirty && <span className="holodeck-dirty"> *</span>}
          {saving && <span className="holodeck-saving"> saving...</span>}
        </div>
        <button className="holodeck-close" onClick={onClose}>&times;</button>
      </div>

      <div className="holodeck-body">
        {/* File sidebar */}
        <div className="holodeck-sidebar">
          {editableFiles.map(f => (
            <div
              key={f.path}
              className={`holodeck-file ${f.path === activeFile ? 'active' : ''}`}
              onClick={() => loadFile(f.path)}
              title={f.path}
            >
              {f.name}
            </div>
          ))}
        </div>

        {/* Editor area — placeholder and mount point are siblings, not nested */}
        <div className="holodeck-editor" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {!activeFile ? (
            <div className="holodeck-placeholder">
              Select a file to edit
            </div>
          ) : (
            <div
              ref={editorRef}
              style={{ flex: 1, overflow: 'hidden' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
