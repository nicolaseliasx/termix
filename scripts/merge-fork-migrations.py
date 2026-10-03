"""Place upstream SQL migrations after this fork's persistent-session migration.

The fork and upstream both added migration 0015 after the same base.  Drizzle
tracks a migration's timestamp in the journal, so renaming files alone would
silently skip upstream migrations on existing fork installations.
"""

import json
import subprocess
from pathlib import Path


def git_file(revision: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{revision}:{path}"])


for dialect in ("mysql", "postgres"):
    root = Path("drizzle") / dialect
    meta = root / "meta"
    fork_journal = json.loads(git_file("fork/baseline", str(meta / "_journal.json")))
    upstream_journal = json.loads(git_file("fef8a5f", str(meta / "_journal.json")))
    fork_last = fork_journal["entries"][-1]
    assert fork_last["idx"] == 15
    upstream_new = [e for e in upstream_journal["entries"] if e["idx"] >= 15]

    fork_snapshot = json.loads(git_file("fork/baseline", str(meta / "0015_snapshot.json")))
    prior_snapshot = json.loads(git_file("fef8a5f", str(meta / "0014_snapshot.json")))
    fork_tables = {
        key: value
        for key, value in fork_snapshot["tables"].items()
        if key not in prior_snapshot["tables"]
    }
    assert len(fork_tables) == 2
    recordings_key = (
        "public.session_recordings" if dialect == "postgres" else "session_recordings"
    )
    fork_ended_at = fork_snapshot["tables"][recordings_key]["columns"]["ended_at"]

    # Load every upstream object before rewriting paths, since 0016 becomes
    # 0017, 0017 becomes 0018, and so on.
    migrations = []
    for entry in upstream_new:
        index = entry["idx"]
        old_tag = entry["tag"]
        sql = git_file("fef8a5f", str(root / f"{old_tag}.sql"))
        snapshot = json.loads(
            git_file("fef8a5f", str(meta / f"{index:04}_snapshot.json"))
        )
        migrations.append((entry, sql, snapshot))

    for entry, _, _ in migrations:
        (root / f"{entry['tag']}.sql").unlink()
        old_snapshot = meta / f"{entry['idx']:04}_snapshot.json"
        if old_snapshot.exists() and entry["idx"] != 15:
            old_snapshot.unlink()

    merged_entries = list(fork_journal["entries"])
    for offset, (entry, sql, snapshot) in enumerate(migrations, start=1):
        new_index = 15 + offset
        new_tag = f"{new_index:04}_{entry['tag'][5:]}"
        (root / f"{new_tag}.sql").write_bytes(sql)
        snapshot["tables"].update(fork_tables)
        snapshot["tables"][recordings_key]["columns"]["ended_at"] = fork_ended_at
        if offset == 1:
            snapshot["prevId"] = fork_snapshot["id"]
        (meta / f"{new_index:04}_snapshot.json").write_text(
            json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"
        )
        merged_entries.append(
            {
                **entry,
                "idx": new_index,
                "when": fork_last["when"] + offset,
                "tag": new_tag,
            }
        )

    (meta / "_journal.json").write_text(
        json.dumps({**fork_journal, "entries": merged_entries}, indent=2) + "\n"
    )
