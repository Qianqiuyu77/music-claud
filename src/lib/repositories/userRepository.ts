import type { AppDatabase, BindParams } from "@/lib/db/client";

export type AppUser = {
  id: number;
  handle: string;
  nickname: string | null;
};

export type UserLoginStateInput = {
  userId: number;
  provider: "netease";
  encryptedCookie: string;
  status: "active" | "expired" | "revoked";
  source: "cookie" | "qr";
};

export class UserRepository {
  constructor(private readonly db: AppDatabase) {}

  getDefaultOwner(): AppUser {
    const row = this.getFirst<{ id: number; handle: string | null; nickname: string | null }>(
      "SELECT id, handle, nickname FROM users WHERE id = 1"
    );
    if (!row) throw new Error("Default owner user is missing");
    return { id: row.id, handle: row.handle ?? "owner", nickname: row.nickname };
  }

  getUserById(userId: number): AppUser | null {
    const row = this.getFirst<{ id: number; handle: string | null; nickname: string | null }>(
      "SELECT id, handle, nickname FROM users WHERE id = $userId",
      { $userId: userId }
    );
    if (!row) return null;
    return { id: row.id, handle: row.handle ?? `user-${row.id}`, nickname: row.nickname };
  }

  findOrCreateInviteUser(inviteCode: string, nickname?: string | null): AppUser {
    const handle = `invite_${slugInviteCode(inviteCode)}`;
    const existing = this.getFirst<{ id: number; handle: string | null; nickname: string | null }>(
      "SELECT id, handle, nickname FROM users WHERE handle = $handle",
      { $handle: handle }
    );
    if (existing) return { id: existing.id, handle: existing.handle ?? handle, nickname: existing.nickname };

    this.db.run(
      "INSERT INTO users (handle, nickname) VALUES ($handle, $nickname)",
      { $handle: handle, $nickname: nickname?.trim() || handle }
    );
    const id = this.getFirst<{ id: number }>("SELECT last_insert_rowid() AS id")?.id ?? 0;
    return { id, handle, nickname: nickname?.trim() || handle };
  }

  createAnonymousBrowserUser(): AppUser {
    const handle = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    this.db.run("INSERT INTO users (handle, nickname) VALUES ($handle, $nickname)", {
      $handle: handle,
      $nickname: null
    });
    const id = this.getFirst<{ id: number }>("SELECT last_insert_rowid() AS id")?.id ?? 0;
    return { id, handle, nickname: null };
  }

  saveLoginState(input: UserLoginStateInput) {
    this.db.run(
      `
        INSERT INTO user_login_states (user_id, provider, encrypted_cookie, status, source, last_verified_at)
        VALUES ($userId, $provider, $encryptedCookie, $status, $source, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          encrypted_cookie = excluded.encrypted_cookie,
          status = excluded.status,
          source = excluded.source,
          last_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `,
      {
        $userId: input.userId,
        $provider: input.provider,
        $encryptedCookie: input.encryptedCookie,
        $status: input.status,
        $source: input.source
      }
    );
  }

  getLoginState(userId: number, provider: "netease") {
    const row = this.getFirst<{
      user_id: number;
      provider: "netease";
      encrypted_cookie: string;
      status: "active" | "expired" | "revoked";
      source: "cookie" | "qr";
      last_verified_at: string | null;
    }>(
      "SELECT user_id, provider, encrypted_cookie, status, source, last_verified_at FROM user_login_states WHERE user_id = $userId AND provider = $provider",
      { $userId: userId, $provider: provider }
    );
    if (!row) return null;
    return {
      userId: row.user_id,
      provider: row.provider,
      encryptedCookie: row.encrypted_cookie,
      status: row.status,
      source: row.source,
      lastVerifiedAt: row.last_verified_at
    };
  }

  updateLoginStateStatus(userId: number, provider: "netease", status: UserLoginStateInput["status"]) {
    this.db.run(
      `
        UPDATE user_login_states
        SET status = $status,
            last_verified_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $userId AND provider = $provider
      `,
      { $userId: userId, $provider: provider, $status: status }
    );
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(params ?? {}) as T | undefined;
  }
}

function slugInviteCode(inviteCode: string) {
  const slug = inviteCode.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Invite code is required");
  return slug.slice(0, 64);
}
