import * as vscode from "vscode";

const STORAGE_KEY = "molvis.recentFiles";
const DEFAULT_MAX = 12;

/**
 * Persists recently opened molecular URIs for the activity-bar launcher.
 * Stored as URI strings in `globalState` so the list survives reloads and
 * works across multi-root workspaces (remote SSH paths included).
 */
export class RecentFilesStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly maxEntries = DEFAULT_MAX,
  ) {}

  /** Most-recent-first list of stored URIs. Invalid entries are filtered out. */
  list(): vscode.Uri[] {
    const raw = this.memento.get<unknown>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) return [];

    const uris: vscode.Uri[] = [];
    for (const entry of raw) {
      if (typeof entry !== "string" || entry.length === 0) continue;
      try {
        uris.push(vscode.Uri.parse(entry, true));
      } catch {
        // Skip corrupt entries rather than failing the whole list.
      }
    }
    return uris;
  }

  async add(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    const next = [
      key,
      ...this.list()
        .map((u) => u.toString())
        .filter((s) => s !== key),
    ].slice(0, this.maxEntries);

    await this.memento.update(STORAGE_KEY, next);
    this._onDidChange.fire();
  }

  async remove(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    const next = this.list()
      .map((u) => u.toString())
      .filter((s) => s !== key);
    await this.memento.update(STORAGE_KEY, next);
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.memento.update(STORAGE_KEY, []);
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
