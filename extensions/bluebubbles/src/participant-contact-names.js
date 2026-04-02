import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const CONTACT_NAME_CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_CONTACT_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PARTICIPANT_CONTACT_NAME_CACHE_ENTRIES = 2048;
const SQLITE_MAX_BUFFER = 8 * 1024 * 1024;
const SQLITE_PHONE_DIGITS_SQL = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.ZFULLNUMBER, ''), ' ', ''), '(', ''), ')', ''), '-', ''), '+', ''), '.', ''), '\n', ''), '\r', '')";
const participantContactNameCache = new Map();
let participantContactNameDepsForTest;
function normalizePhoneLookupKey(value) {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
        return null;
    }
    const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    return normalized.length >= 7 ? normalized : null;
}
function uniqueNormalizedPhoneLookupKeys(phoneKeys) {
    const unique = new Set();
    for (const phoneKey of phoneKeys) {
        const normalized = normalizePhoneLookupKey(phoneKey);
        if (normalized) {
            unique.add(normalized);
        }
    }
    return [...unique];
}
function resolveParticipantPhoneLookupKey(participant) {
    if (participant.id.includes("@")) {
        return null;
    }
    return normalizePhoneLookupKey(participant.id);
}
function trimParticipantContactNameCache(now) {
    for (const [phoneKey, entry] of participantContactNameCache) {
        if (entry.expiresAt <= now) {
            participantContactNameCache.delete(phoneKey);
        }
    }
    while (participantContactNameCache.size > MAX_PARTICIPANT_CONTACT_NAME_CACHE_ENTRIES) {
        const oldestPhoneKey = participantContactNameCache.keys().next().value;
        if (!oldestPhoneKey) {
            return;
        }
        participantContactNameCache.delete(oldestPhoneKey);
    }
}
function readFreshCacheEntry(phoneKey, now) {
    const cached = participantContactNameCache.get(phoneKey);
    if (!cached) {
        return null;
    }
    if (cached.expiresAt <= now) {
        participantContactNameCache.delete(phoneKey);
        return null;
    }
    participantContactNameCache.delete(phoneKey);
    participantContactNameCache.set(phoneKey, cached);
    return cached;
}
function writeCacheEntry(phoneKey, name, now) {
    participantContactNameCache.delete(phoneKey);
    participantContactNameCache.set(phoneKey, {
        name,
        expiresAt: now + (name ? CONTACT_NAME_CACHE_TTL_MS : NEGATIVE_CONTACT_NAME_CACHE_TTL_MS),
    });
    trimParticipantContactNameCache(now);
}
function buildAddressBookSourcesDir(homeDir) {
    const trimmedHomeDir = homeDir?.trim();
    if (!trimmedHomeDir) {
        return null;
    }
    return join(trimmedHomeDir, "Library", "Application Support", "AddressBook", "Sources");
}
async function fileExists(path, deps) {
    try {
        await deps.access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function listContactsDatabases(deps) {
    const sourcesDir = buildAddressBookSourcesDir(deps.homeDir);
    if (!sourcesDir) {
        return [];
    }
    let entries = [];
    try {
        entries = await deps.readdir(sourcesDir);
    }
    catch {
        return [];
    }
    const databases = [];
    for (const entry of entries) {
        const dbPath = join(sourcesDir, entry, "AddressBook-v22.abcddb");
        if (await fileExists(dbPath, deps)) {
            databases.push(dbPath);
        }
    }
    return databases;
}
function buildSqlitePhoneKeyList(phoneKeys) {
    return uniqueNormalizedPhoneLookupKeys(phoneKeys)
        .map((phoneKey) => `'${phoneKey}'`)
        .join(", ");
}
async function queryContactsDatabase(dbPath, phoneKeys, deps) {
    const sqlitePhoneKeyList = buildSqlitePhoneKeyList(phoneKeys);
    if (!sqlitePhoneKeyList) {
        return [];
    }
    const sql = `
SELECT digits, name
FROM (
  SELECT
    ${SQLITE_PHONE_DIGITS_SQL} AS digits,
    TRIM(
      CASE
        WHEN TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')) != ''
          THEN TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, ''))
        ELSE COALESCE(r.ZORGANIZATION, '')
      END
    ) AS name
  FROM ZABCDRECORD r
  JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
  WHERE p.ZFULLNUMBER IS NOT NULL
)
WHERE digits IN (${sqlitePhoneKeyList})
  AND name != '';
`;
    const options = {
        encoding: "utf8",
        maxBuffer: SQLITE_MAX_BUFFER,
    };
    const { stdout } = await deps.execFileAsync("sqlite3", ["-separator", "\t", dbPath, sql], options);
    const rows = [];
    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const [digitsRaw, ...nameParts] = trimmed.split("\t");
        const phoneKey = normalizePhoneLookupKey(digitsRaw ?? "");
        const name = nameParts.join("\t").trim();
        if (!phoneKey || !name) {
            continue;
        }
        rows.push({ phoneKey, name });
    }
    return rows;
}
async function resolvePhoneNamesFromMacOsContacts(phoneKeys, deps) {
    const normalizedPhoneKeys = uniqueNormalizedPhoneLookupKeys(phoneKeys);
    if (normalizedPhoneKeys.length === 0) {
        return new Map();
    }
    const databases = await listContactsDatabases(deps);
    if (databases.length === 0) {
        return new Map();
    }
    const unresolved = new Set(normalizedPhoneKeys);
    const resolved = new Map();
    for (const dbPath of databases) {
        let rows = [];
        try {
            rows = await queryContactsDatabase(dbPath, [...unresolved], deps);
        }
        catch {
            continue;
        }
        for (const row of rows) {
            if (!unresolved.has(row.phoneKey) || resolved.has(row.phoneKey)) {
                continue;
            }
            resolved.set(row.phoneKey, row.name);
            unresolved.delete(row.phoneKey);
            if (unresolved.size === 0) {
                return resolved;
            }
        }
    }
    return resolved;
}
function resolveLookupDeps(deps) {
    const merged = {
        ...participantContactNameDepsForTest,
        ...deps,
    };
    return {
        platform: merged.platform ?? process.platform,
        now: merged.now ?? (() => Date.now()),
        resolvePhoneNames: merged.resolvePhoneNames,
        homeDir: merged.homeDir ?? process.env.HOME,
        readdir: merged.readdir ?? readdir,
        access: merged.access ?? access,
        execFileAsync: merged.execFileAsync ?? execFileAsync,
    };
}
export async function enrichBlueBubblesParticipantsWithContactNames(participants, deps) {
    if (!Array.isArray(participants) || participants.length === 0) {
        return [];
    }
    const resolvedDeps = resolveLookupDeps(deps);
    const lookup = resolvedDeps.resolvePhoneNames ??
        ((phoneKeys) => resolvePhoneNamesFromMacOsContacts(phoneKeys, resolvedDeps));
    const shouldAttemptLookup = Boolean(resolvedDeps.resolvePhoneNames) || resolvedDeps.platform === "darwin";
    if (!shouldAttemptLookup) {
        return participants;
    }
    const nowMs = resolvedDeps.now();
    trimParticipantContactNameCache(nowMs);
    const pendingPhoneKeys = new Set();
    const cachedNames = new Map();
    for (const participant of participants) {
        if (participant.name?.trim()) {
            continue;
        }
        const phoneKey = resolveParticipantPhoneLookupKey(participant);
        if (!phoneKey) {
            continue;
        }
        const cached = readFreshCacheEntry(phoneKey, nowMs);
        if (cached?.name) {
            cachedNames.set(phoneKey, cached.name);
            continue;
        }
        if (!cached) {
            pendingPhoneKeys.add(phoneKey);
        }
    }
    if (pendingPhoneKeys.size > 0) {
        try {
            const resolved = await lookup([...pendingPhoneKeys]);
            for (const phoneKey of pendingPhoneKeys) {
                const name = resolved.get(phoneKey)?.trim() || undefined;
                writeCacheEntry(phoneKey, name, nowMs);
                if (name) {
                    cachedNames.set(phoneKey, name);
                }
            }
        }
        catch {
            return participants;
        }
    }
    let didChange = false;
    const enriched = participants.map((participant) => {
        if (participant.name?.trim()) {
            return participant;
        }
        const phoneKey = resolveParticipantPhoneLookupKey(participant);
        if (!phoneKey) {
            return participant;
        }
        const name = cachedNames.get(phoneKey)?.trim();
        if (!name) {
            return participant;
        }
        didChange = true;
        return { ...participant, name };
    });
    return didChange ? enriched : participants;
}
export async function listBlueBubblesContactsDatabasesForTest(deps) {
    return listContactsDatabases(resolveLookupDeps(deps));
}
export async function queryBlueBubblesContactsDatabaseForTest(dbPath, phoneKeys, deps) {
    return queryContactsDatabase(dbPath, phoneKeys, resolveLookupDeps(deps));
}
export async function resolveBlueBubblesParticipantContactNamesFromMacOsContactsForTest(phoneKeys, deps) {
    return resolvePhoneNamesFromMacOsContacts(phoneKeys, resolveLookupDeps(deps));
}
export function resetBlueBubblesParticipantContactNameCacheForTest() {
    participantContactNameCache.clear();
}
export function setBlueBubblesParticipantContactDepsForTest(deps) {
    participantContactNameDepsForTest = deps;
    participantContactNameCache.clear();
}
