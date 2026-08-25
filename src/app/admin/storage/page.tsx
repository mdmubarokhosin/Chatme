"use client";

/**
 * Storage Manager — GitHub-hosted media browser for admins.
 * Lists files in the configured private repo (live from settings/githubStorage
 * in the DB), supports:
 *   - Browse directories (root + subfolders)
 *   - View image previews inline
 *   - Edit text files (replace content)
 *   - Rename files (move within same directory)
 *   - Delete files
 *   - Recursively delete directories
 *   - Test connection to verify the token/repo config
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  File as FileIcon,
  FileText,
  Folder,
  HardDrive,
  Home,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/utils";
import { t } from "@/lib/i18n";

import {
  deleteGithubDirectory,
  deleteGithubFile,
  fetchGithubFileBlobUrl,
  getGithubSettings,
  getGithubFile,
  listGithubFiles,
  migrateFileLinks,
  renameGithubFile,
  testGithubConnection,
  updateGithubFile,
  uploadGithubFile,
  useAdmin,
  useAdminLang,
  type GitHubFile,
} from "../_lib/admin-store";

export default function AdminStoragePage() {
  const settings = useAdmin((s) => s.settings);
  const lang = useAdminLang();
  const tr = (key: string) => t(lang, key);
  const [path, setPath] = useState<string>(""); // current directory path
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      await uploadGithubFile(path, file);
      toast.success(tr("admin.uploaded"));
      refresh(path);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setUploading(false);
  }
  const [history, setHistory] = useState<string[]>([]); // breadcrumb stack
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [editing, setEditing] = useState<GitHubFile | null>(null);
  const [renaming, setRenaming] = useState<GitHubFile | null>(null);
  const [previewing, setPreviewing] = useState<GitHubFile | null>(null);

  // Live DB-cached settings (also editable on /admin/settings)
  const github = settings.githubStorage || { token: "", repo: "", branch: "main" };

  const refresh = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const list = await listGithubFiles(dirPath);
      // Sort: dirs first, then files, alphabetically
      list.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(list);
    } catch (e) {
      toast.error((e as Error).message || "Failed to list files");
      setFiles([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Only auto-load once credentials are present
    if (github.token && github.repo) {
      refresh("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [github.token, github.repo]);

  function navigateTo(dir: string) {
    setHistory((h) => [...h, path]);
    setPath(dir);
    refresh(dir);
  }

  function goBack() {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory((h) => h.slice(0, -1));
    setPath(prev);
    refresh(prev);
  }

  function goRoot() {
    setHistory([]);
    setPath("");
    refresh("");
  }

  async function handleDelete(f: GitHubFile) {
    if (!confirm(`${tr("admin.confirmDeleteFile")} ${f.type === "dir" ? tr("admin.confirmDeleteDir") : `"${f.path}"`}?`)) return;
    try {
      if (f.type === "dir") {
        const count = await deleteGithubDirectory(f.path);
        toast.success(`${count} ${tr("admin.filesDeleted")}`);
      } else {
        await deleteGithubFile(f.path);
        toast.success(tr("admin.fileDeleted"));
      }
      refresh(path);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleTestConnection() {
    const r = await testGithubConnection();
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
  }

  if (!github.token || !github.repo) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tr("admin.storageTitle")}</h1>
          <p className="text-muted-foreground text-sm">
            {tr("admin.storageSubtitle")}
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{tr("admin.notConfigured")}</CardTitle>
            <CardDescription>
              {tr("admin.notConfiguredDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href="/admin/settings">{tr("admin.goToSettings")}</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tr("admin.storageTitle")}</h1>
          <p className="text-muted-foreground text-sm">
            Files in <span className="font-mono text-foreground">{github.repo}</span> · branch{" "}
            <span className="font-mono text-foreground">{github.branch}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await handleUpload(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? tr("admin.uploading") : tr("admin.upload")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleTestConnection}>
            <HardDrive className="size-4" /> {tr("admin.testConnection")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refresh(path)}>
            <RefreshCw className="size-4" /> {tr("admin.refresh")}
          </Button>
        </div>
      </div>

      {/* Credentials preview */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="gap-1">
              <Folder className="size-3" /> Repo
            </Badge>
            <span className="font-mono">{github.repo}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="gap-1">
              <FileText className="size-3" /> Branch
            </Badge>
            <span className="font-mono">{github.branch}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="gap-1">
              <HardDrive className="size-3" /> Token
            </Badge>
            <span className="font-mono text-xs">
              {showToken
                ? github.token
                : `${github.token.slice(0, 6)}${"•".repeat(20)}${github.token.slice(-4)}`}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle token visibility" onClick={() => setShowToken((v) => !v)}>
              {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm">
        <Button variant="ghost" size="icon-sm" aria-label="Go to root" onClick={goRoot} disabled={!path}>
          <Home className="size-4" />
        </Button>
        <ChevronRight className="text-muted-foreground size-3" />
        <span className="font-mono text-muted-foreground">
          {path || tr("admin.root")}
        </span>
        {path && (
          <Button variant="ghost" size="sm" className="ml-2" onClick={goBack}>
            {tr("admin.back")}
          </Button>
        )}
      </div>

      {/* File list */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">{files.length} {tr("admin.items")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2 className="size-4 animate-spin" /> {tr("common.loading")}
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="text-muted-foreground py-10 text-center text-sm">{tr("admin.emptyDir")}</div>
          )}
          <ScrollArea className="max-h-[60vh]">
            <div className="flex flex-col">
              {files.map((f) => (
                <FileRow
                  key={f.sha}
                  file={f}
                  lang={lang}
                  onNavigate={() => f.type === "dir" && navigateTo(f.path)}
                  onDelete={() => handleDelete(f)}
                  onEdit={() => setEditing(f)}
                  onRename={() => setRenaming(f)}
                  onPreview={() => setPreviewing(f)}
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      {editing && <EditFileDialog file={editing} lang={lang} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(path); }} />}

      {/* Rename dialog */}
      {renaming && (
        <RenameDialog
          file={renaming}
          lang={lang}
          onClose={() => setRenaming(null)}
          onDone={async (newName) => {
            try {
              toast.info(tr("admin.replacing"));
              const { oldUrl, newUrl } = await renameGithubFile(renaming.path, newName);
              // Migrate every Firebase record that references the old link
              const updated = await migrateFileLinks(oldUrl, newUrl);
              if (updated > 0) toast.success(`${tr("admin.renamed")} — ${updated} ${tr("admin.linksUpdated")}`);
              else toast.success(tr("admin.renamed"));
              setRenaming(null);
              refresh(path);
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}

      {/* Preview dialog */}
      {previewing && <PreviewDialog file={previewing} lang={lang} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

function FileRow({
  file,
  lang,
  onNavigate,
  onDelete,
  onEdit,
  onRename,
  onPreview,
}: {
  file: GitHubFile;
  lang: string;
  onNavigate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRename: () => void;
  onPreview: () => void;
}) {
  const tr = (key: string) => t(lang as "en" | "bn", key);
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(file.name);
  const isText = /\.(txt|md|json|js|ts|tsx|jsx|css|html|csv|yml|yaml|xml|ini|conf)$/i.test(file.name);
  /* Private repos: download_url is null — fetch thumbnails via the
     token-authenticated API as blob URLs. */
  const [thumb, setThumb] = useState<string | null>(file.download_url);
  useEffect(() => {
    if (file.type !== "file" || !isImage || file.download_url) return;
    let alive = true;
    fetchGithubFileBlobUrl(file.path)
      .then((u) => {
        if (alive) setThumb(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.path, file.download_url, file.type, isImage]);

  return (
    <div className="group flex items-center gap-3 border-t px-4 py-2 hover:bg-muted/40">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => (file.type === "dir" ? onNavigate() : onPreview())}
      >
        {file.type === "dir" ? (
          <Folder className="size-4 shrink-0 text-amber-500" />
        ) : isImage ? (
          <ImageIcon className="size-4 shrink-0 text-blue-500" />
        ) : (
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{formatBytes(file.size)}</span>
        {file.type === "file" && isImage && thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-8 rounded border object-cover" />
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {file.type === "file" && isText && (
          <Button variant="ghost" size="icon-sm" aria-label={tr("admin.edit")} onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
        )}
        {file.type === "file" && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label={tr("admin.rename")} onClick={onRename}>
              <FileText className="size-3.5" />
            </Button>
            {file.type === "file" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tr("admin.openInNewTab")}
                onClick={async () => {
                  try {
                    // Private repos: raw URLs 404 — open the token-fetched blob URL
                    const url = file.download_url || (await fetchGithubFileBlobUrl(file.path));
                    window.open(url, "_blank");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={tr("common.delete")} className="text-destructive" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EditFileDialog({ file, lang, onClose, onSaved }: { file: GitHubFile; lang: string; onClose: () => void; onSaved: () => void }) {
  const tr = (key: string) => t(lang as "en" | "bn", key);
  const [content, setContent] = useState("");
  const [sha, setSha] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getGithubFile(file.path)
      .then((d) => {
        setContent(d.content);
        setSha(d.sha);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [file.path]);

  async function save() {
    setSaving(true);
    try {
      await updateGithubFile(file.path, content, sha);
      toast.success(tr("admin.fileUpdated"));
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <div className="font-medium">{tr("admin.editFile")} {file.name}</div>
            <div className="text-muted-foreground truncate text-xs">{file.path}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="text-muted-foreground py-10 text-center text-sm">{tr("common.loading")}</div>
          ) : (
            <textarea
              className="h-full min-h-[300px] w-full resize-none bg-muted/30 p-4 font-mono text-sm outline-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose}>
            {tr("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? tr("common.saving") : tr("admin.saveChanges")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RenameDialog({
  file,
  lang,
  onClose,
  onDone,
}: {
  file: GitHubFile;
  lang: string;
  onClose: () => void;
  onDone: (newName: string) => void;
}) {
  const tr = (key: string) => t(lang as "en" | "bn", key);
  const [name, setName] = useState(file.name);

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border bg-background p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">{tr("admin.rename")} — {file.name}</h3>
        <Label htmlFor="ren-name" className="text-muted-foreground text-xs">
          {tr("admin.renameHint")}
        </Label>
        <div className="text-muted-foreground mt-1 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs leading-relaxed">
          <FileText className="mt-0.5 size-3 shrink-0 text-amber-500" />
          {tr("admin.renameLinkNotice")}
        </div>
        <Input id="ren-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("common.cancel")}
          </Button>
          <Button
            onClick={() => onDone(name.trim() || file.name)}
            disabled={!name.trim() || name.trim() === file.name}
          >
            {tr("admin.rename")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewDialog({ file, lang, onClose }: { file: GitHubFile; lang: string; onClose: () => void }) {
  const tr = (key: string) => t(lang as "en" | "bn", key);
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(file.name);
  const isAudio = /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name);
  const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);
  /* Private repos: download_url is null — resolve media as a blob URL via
     the token-authenticated Contents API. */
  const [mediaSrc, setMediaSrc] = useState<string | null>(file.download_url);
  useEffect(() => {
    if (file.download_url) return;
    let alive = true;
    fetchGithubFileBlobUrl(file.path)
      .then((u) => {
        if (alive) setMediaSrc(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.path, file.download_url]);

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] max-w-3xl flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 text-sm backdrop-blur">
          <div className="min-w-0">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-muted-foreground truncate text-xs">{file.path} · {formatBytes(file.size)}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="flex items-center justify-center rounded-lg bg-black/40 p-4">
          {!mediaSrc ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> {tr("common.loading")}
            </div>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaSrc} alt={file.name} className="max-h-[70vh] max-w-full rounded-lg object-contain" />
          ) : isAudio ? (
            <audio src={mediaSrc} controls className="w-full max-w-md" />
          ) : isVideo ? (
            <video src={mediaSrc} controls className="max-h-[70vh] max-w-full rounded-lg" />
          ) : (
            <div className="text-muted-foreground text-center text-sm">
              <FileIcon className="mx-auto mb-3 size-12 opacity-50" />
              {tr("admin.previewUnavailable")}
              <div>
                <button
                  type="button"
                  className="text-primary mt-2 inline-block hover:underline"
                  onClick={() => window.open(mediaSrc, "_blank")}
                >
                  {tr("admin.openRaw")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
