//! Collapses session files that are versions of one piece of work — the Rust
//! twin of `src/main/lib/versions.ts`.
//!
//! A name is only shortened when the result matches a sibling in the same
//! folder, so a project genuinely called "Studio 54" keeps its name. Same
//! folder only, deliberately. This is display only: records stay keyed on the
//! session file path.

use crate::scanner::{flatten, Entry};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

const STATE_WORDS: [&str; 62] = [
    "bounced", "bounce", "final", "finale", "master", "mastered", "mixdown", "mixed", "mix", "export", "exported", "rough", "edit",
    "wip", "copy", "new", "old", "backup", "temp", "film", "video", "trim", "cut", "arrng", "arr", "arrang", "arrangement",
    "rearrng", "re-arrng", "adds", "add", "remix", "vip", "dub", "extended", "radio", "club", "short", "long", "alt", "alternate",
    "demo", "idea", "sketch", "part", "pt", "session", "rec", "recording", "vocal", "vox", "inst", "instrumental", "lead",
    "mastering", "stems", "stem", "opt", "option", "take", "project", "track",
];

fn trailing_number() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)[ _.\-]*#?v?[0-9]+([_.\-][0-9]+)*$").unwrap())
}

fn for_phrase() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)[ _.\-]+(for|with|to)[ _.\-]+[a-z0-9]+$").unwrap())
}

fn folder_suffix() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)[ _.\-]+(project|sessions?)$").unwrap())
}

fn state_word_res() -> &'static Vec<Regex> {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    R.get_or_init(|| STATE_WORDS.iter().map(|w| Regex::new(&format!(r"(?i)[ _.\-]+{}$", regex::escape(w))).unwrap()).collect())
}

/// JavaScript String.prototype.trim (whitespace incl. NBSP and BOM).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `str.replace(re, '')` — JavaScript replaces only the first match.
fn replace_first(re: &Regex, s: &str) -> String {
    re.replacen(s, 1, "").to_string()
}

/// Peel one layer off the end of a name; None when nothing is left to remove.
pub fn peel(name: &str) -> Option<String> {
    let trimmed = js_trim(name).to_string();

    let numbered = js_trim(&replace_first(trailing_number(), &trimmed)).to_string();
    if numbered != trimmed && !numbered.is_empty() {
        return Some(numbered);
    }
    let phrase = js_trim(&replace_first(for_phrase(), &trimmed)).to_string();
    if phrase != trimmed && !phrase.is_empty() {
        return Some(phrase);
    }
    let lower = trimmed.to_lowercase();
    for re in state_word_res() {
        if re.is_match(&lower) {
            let stripped = js_trim(&replace_first(re, &trimmed)).to_string();
            if !stripped.is_empty() {
                return Some(stripped);
            }
        }
    }
    None
}

/// Every progressively shorter form of a name, longest first.
pub fn stems(name: &str) -> Vec<String> {
    let mut out = vec![js_trim(name).to_string()];
    let mut current = js_trim(name).to_string();
    for _ in 0..10 {
        match peel(&current) {
            Some(next) if next != current => {
                out.push(next.clone());
                current = next;
            }
            _ => break,
        }
    }
    out
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn common_word_prefix(a: &str, b: &str) -> Option<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    let split = R.get_or_init(|| Regex::new(r"[ _.\-]+").unwrap());
    let wa: Vec<&str> = split.split(js_trim(a)).collect();
    let wb: Vec<&str> = split.split(js_trim(b)).collect();
    let mut common = Vec::new();
    for k in 0..wa.len().min(wb.len()) {
        if wa[k].to_lowercase() == wb[k].to_lowercase() {
            common.push(wa[k]);
        } else {
            break;
        }
    }
    if common.len() >= 2 || (common.len() == 1 && utf16_len(common[0]) >= 4) {
        Some(common.join(" "))
    } else {
        None
    }
}

fn effective_modified(e: &Entry) -> f64 {
    e.modified.max(e.render_modified).max(e.last_activity)
}

/// Insertion-ordered map of flattened stem → label and member indices.
struct Reach {
    order: Vec<String>,
    info: HashMap<String, (String, Vec<usize>)>,
}

impl Reach {
    fn add(&mut self, flat: &str, label: &str, member: usize, shorter_label_wins: bool) {
        let slot = self.info.entry(flat.to_string()).or_insert_with(|| {
            self.order.push(flat.to_string());
            (label.to_string(), Vec::new())
        });
        if !slot.1.contains(&member) {
            slot.1.push(member);
        }
        if shorter_label_wins && utf16_len(label) < utf16_len(&slot.0) {
            slot.0 = label.to_string();
        }
    }
}

fn basename(p: &str) -> &str {
    let trimmed = p.trim_end_matches(['/', '\\']);
    trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed)
}

fn as_row(e: &Entry) -> Value {
    let mut v = serde_json::to_value(e).unwrap();
    let obj = v.as_object_mut().unwrap();
    obj.insert("isGroup".into(), json!(false));
    obj.insert("versions".into(), json!([serde_json::to_value(e).unwrap()]));
    obj.insert("versionCount".into(), json!(1));
    v
}

/// The group row borrows the newest member's numbers.
fn as_group(label: &str, members: &[&Entry]) -> Value {
    let newest = members[0];
    let mut v = serde_json::to_value(newest).unwrap();
    let max = |f: fn(&Entry) -> f64| members.iter().map(|e| f(e)).fold(f64::NEG_INFINITY, f64::max);
    let obj = v.as_object_mut().unwrap();
    obj.insert("name".into(), json!(label));
    obj.insert("isGroup".into(), json!(true));
    obj.insert("versions".into(), json!(members.iter().map(|e| serde_json::to_value(e).unwrap()).collect::<Vec<_>>()));
    obj.insert("versionCount".into(), json!(members.len()));
    obj.insert("modified".into(), json!(max(|e| e.modified)));
    obj.insert("renderModified".into(), json!(max(|e| e.render_modified)));
    obj.insert("lastActivity".into(), json!(max(effective_modified)));
    obj.insert("audioCount".into(), json!(members.iter().map(|e| e.audio_count).sum::<usize>()));
    obj.insert("backupCount".into(), json!(members.iter().map(|e| e.backup_count).max().unwrap_or(0)));
    obj.insert("health".into(), json!(max(|e| e.health)));
    v
}

/// Display rows: a lone entry stays a plain row, a group becomes one row
/// carrying its versions. Same algorithm and ordering as versions.ts.
pub fn group_versions(entries: &[Entry]) -> Vec<Value> {
    // Folders in first-seen order, case-insensitively.
    let mut folder_order: Vec<String> = Vec::new();
    let mut by_folder: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        let key = e.folder.to_lowercase();
        by_folder.entry(key.clone()).or_insert_with(|| {
            folder_order.push(key.clone());
            Vec::new()
        });
        by_folder.get_mut(&key).unwrap().push(i);
    }

    let mut rows: Vec<(f64, Value)> = Vec::new();
    for key in &folder_order {
        let group = &by_folder[key];
        if group.len() == 1 {
            let e = &entries[group[0]];
            rows.push((effective_modified(e), as_row(e)));
            continue;
        }

        let mut reach = Reach { order: Vec::new(), info: HashMap::new() };
        // 1. stems of each file
        for &i in group {
            for stem in stems(&entries[i].name) {
                let flat = flatten(&stem);
                if flat.len() < 3 {
                    continue;
                }
                reach.add(&flat, &stem, i, true);
            }
        }
        // 2. stems of the folder name itself
        let first_folder = &entries[group[0]].folder;
        if !first_folder.is_empty() {
            let folder_base = js_trim(&replace_first(folder_suffix(), basename(first_folder))).to_string();
            if utf16_len(&folder_base) >= 3 {
                for f_stem in stems(&folder_base) {
                    let flat_f = flatten(&f_stem);
                    if flat_f.len() < 3 {
                        continue;
                    }
                    for &i in group {
                        let ef = flatten(&entries[i].name);
                        if ef.starts_with(&flat_f) || flat_f.starts_with(&ef) {
                            reach.add(&flat_f, &f_stem, i, false);
                        }
                    }
                }
            }
        }
        // 3. shared word prefixes across siblings
        for a in 0..group.len() {
            for b in a + 1..group.len() {
                let Some(prefix) = common_word_prefix(&entries[group[a]].name, &entries[group[b]].name) else { continue };
                if utf16_len(&prefix) < 3 {
                    continue;
                }
                let flat_p = flatten(&prefix);
                for &i in group {
                    let ef = flatten(&entries[i].name);
                    if ef.starts_with(&flat_p) || flat_p.starts_with(&ef) {
                        reach.add(&flat_p, &prefix, i, false);
                    }
                }
            }
        }

        // Most files covered first; ties go to the longer, more specific stem.
        let mut candidates: Vec<&String> = reach.order.iter().filter(|k| reach.info[*k].1.len() > 1).collect();
        candidates.sort_by(|a, b| {
            let (ma, mb) = (reach.info[*a].1.len(), reach.info[*b].1.len());
            mb.cmp(&ma).then(b.len().cmp(&a.len()))
        });

        let mut claimed: Vec<usize> = Vec::new();
        for key in candidates {
            let (label, members) = &reach.info[key];
            let mut free: Vec<usize> = members.iter().copied().filter(|m| !claimed.contains(m)).collect();
            if free.len() < 2 {
                continue;
            }
            claimed.extend(&free);
            free.sort_by(|a, b| effective_modified(&entries[*b]).partial_cmp(&effective_modified(&entries[*a])).unwrap());
            let members: Vec<&Entry> = free.iter().map(|&i| &entries[i]).collect();
            let row = as_group(label, &members);
            let t = row["lastActivity"].as_f64().unwrap_or(0.0).max(row["modified"].as_f64().unwrap_or(0.0)).max(row["renderModified"].as_f64().unwrap_or(0.0));
            rows.push((t, row));
        }
        for &i in group {
            if !claimed.contains(&i) {
                rows.push((effective_modified(&entries[i]), as_row(&entries[i])));
            }
        }
    }

    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    rows.into_iter().map(|(_, v)| v).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peeling() {
        assert_eq!(stems("Nava bharat jodo 3 bounced_2"), vec!["Nava bharat jodo 3 bounced_2", "Nava bharat jodo 3 bounced", "Nava bharat jodo 3", "Nava bharat jodo"]);
        assert_eq!(peel("Studio"), None);
        assert_eq!(peel("Song for film"), Some("Song".into()));
        assert_eq!(common_word_prefix("Drop It 130 adds", "Drop It 130"), Some("Drop It 130".into()));
    }
}
