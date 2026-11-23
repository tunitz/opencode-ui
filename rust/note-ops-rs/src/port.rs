//! Rust port of `plugins/notes/src/note-ops.ts`.

#![forbid(unsafe_code)]

use memchr::memmem::Finder;
use rayon::prelude::*;
use serde_json::{Map, Value, json};

const PARALLEL_MIN_NOTES: usize = 64;
const PARALLEL_MIN_BYTES: usize = 256 * 1024;

const BASE64_TABLE: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut i = 0usize;
    while i < 256 {
        if matches!(i as u8, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/') {
            t[i] = 1;
        }
        i += 1;
    }
    t
};

#[inline]
fn is_ascii_js_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | 0x0B | 0x0C | b'\r')
}

/// Exact ECMAScript `\s` / `String.prototype.trim` character class.
#[inline]
fn is_js_ws(c: char) -> bool {
    if c.is_ascii() {
        return is_ascii_js_ws(c as u8);
    }
    matches!(
        c,
        '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len().min(4096));
    let mut pending = false;
    for c in s.chars() {
        if is_js_ws(c) {
            pending = !out.is_empty();
        } else {
            if pending {
                out.push(' ');
                pending = false;
            }
            out.push(c);
        }
    }
    out
}

#[derive(Default)]
struct Scratch {
    buf: Vec<u8>,
    collapsed: Vec<u8>,
    lower: Vec<u8>,
}

fn lower_ascii_into(bytes: &[u8], out: &mut Vec<u8>) {
    out.clear();
    out.reserve(bytes.len().saturating_sub(out.capacity()));
    out.extend(bytes.iter().map(u8::to_ascii_lowercase));
}

fn collapse_lower_ascii(bytes: &[u8], collapsed: &mut Vec<u8>, lower: &mut Vec<u8>) {
    collapsed.clear();
    lower.clear();
    collapsed.reserve(bytes.len().saturating_sub(collapsed.capacity()));
    lower.reserve(bytes.len().saturating_sub(lower.capacity()));
    let mut pending = false;
    for &b in bytes {
        if is_ascii_js_ws(b) {
            pending = !collapsed.is_empty();
        } else {
            if pending {
                collapsed.push(b' ');
                lower.push(b' ');
                pending = false;
            }
            collapsed.push(b);
            lower.push(b.to_ascii_lowercase());
        }
    }
}

fn count_capped(haystack: &[u8], qlen: usize, finder: &Finder<'_>) -> (Option<usize>, usize) {
    let (mut first, mut count, mut pos) = (None, 0usize, 0usize);
    while pos + qlen <= haystack.len() {
        let Some(rel) = finder.find(&haystack[pos..]) else {
            break;
        };
        let found = pos + rel;
        first.get_or_insert(found);
        count += 1;
        if count == 5 {
            break;
        }
        pos = found + qlen;
    }
    (first, count)
}

fn run_batch<S: Default, T: Send>(
    titles: &[String],
    bodies: &[String],
    f: impl Fn(&mut S, usize) -> Option<T> + Sync,
) -> Vec<T> {
    let count = titles.len().min(bodies.len());
    let total_bytes: usize = titles[..count]
        .iter()
        .zip(&bodies[..count])
        .map(|(t, b)| t.len() + b.len())
        .sum();
    if count >= PARALLEL_MIN_NOTES && total_bytes >= PARALLEL_MIN_BYTES {
        (0..count)
            .into_par_iter()
            .map_init(S::default, |s, i| f(s, i))
            .flatten()
            .collect()
    } else {
        let mut s = S::default();
        (0..count).filter_map(|i| f(&mut s, i)).collect()
    }
}

fn unicode_snippet(collapsed: &str, lower: &str, byte_idx: usize, q_u16: usize) -> Value {
    let idx = crate::utf16::utf16_offset(lower, byte_idx);
    let units = crate::utf16::units(collapsed);
    let start = idx.saturating_sub(80);
    let end = (idx + q_u16 + 80).min(units.len());
    let mut out = Vec::with_capacity(end - start + 2);
    if start > 0 {
        out.push(0x2026);
    }
    out.extend_from_slice(&units[start..end]);
    if end < units.len() {
        out.push(0x2026);
    }
    match String::from_utf16(&out) {
        Ok(s) => Value::String(s),
        Err(_) => json!({ "$utf16": out }),
    }
}

/// Port of `validatedBase64ByteLength` (`plugins/notes/src/note-ops.ts:48`).
pub fn validated_base64_byte_length(value: String) -> Result<f64, String> {
    let bytes = value.as_bytes();
    let n = bytes.len();
    if n == 0 {
        return Ok(0.0);
    }
    if !n.is_multiple_of(4) {
        return Ok(-1.0);
    }
    let [b0, b1, b2, b3] = [bytes[n - 4], bytes[n - 3], bytes[n - 2], bytes[n - 1]];
    if BASE64_TABLE[b0 as usize] == 0 || BASE64_TABLE[b1 as usize] == 0 {
        return Ok(-1.0);
    }
    let padding = match (b2, b3) {
        (b'=', b'=') => 2,
        (c, b'=') if BASE64_TABLE[c as usize] != 0 => 1,
        (c, d) if BASE64_TABLE[c as usize] != 0 && BASE64_TABLE[d as usize] != 0 => 0,
        _ => return Ok(-1.0),
    };
    let (chunks, rem) = bytes[..n - 4].as_chunks::<8>();
    for c in chunks {
        let ok = c.iter().fold(1u8, |acc, &b| acc & BASE64_TABLE[b as usize]);
        if ok == 0 {
            return Ok(-1.0);
        }
    }
    if rem.iter().any(|&b| BASE64_TABLE[b as usize] == 0) {
        return Ok(-1.0);
    }
    Ok(((n / 4) * 3 - padding) as f64)
}

/// Port of `searchNoteTexts` (`plugins/notes/src/note-ops.ts:59`).
pub fn search_note_texts(
    titles: Vec<String>,
    bodies: Vec<String>,
    query: String,
) -> Result<Vec<Value>, String> {
    let lower_query = collapse_ws(&query).to_lowercase();
    if lower_query.is_empty() || titles.is_empty() || bodies.is_empty() {
        return Ok(Vec::new());
    }
    let q_ascii = lower_query.is_ascii();
    let q_len = lower_query.len();
    let q_u16 = if q_ascii {
        q_len
    } else {
        lower_query.encode_utf16().count()
    };
    let finder = Finder::new(lower_query.as_bytes());

    Ok(run_batch(&titles, &bodies, |sc: &mut Scratch, index| {
        let (title, body) = (&titles[index], &bodies[index]);
        let title_match = if q_ascii && title.is_ascii() {
            title.len() >= q_len && {
                lower_ascii_into(title.as_bytes(), &mut sc.buf);
                finder.find(&sc.buf).is_some()
            }
        } else {
            finder.find(title.to_lowercase().as_bytes()).is_some()
        };

        let (occurrences, snippet) = if q_ascii && body.is_ascii() {
            collapse_lower_ascii(body.as_bytes(), &mut sc.collapsed, &mut sc.lower);
            let (first, occ) = count_capped(&sc.lower, q_len, &finder);
            if !title_match && occ == 0 {
                return None;
            }
            let snip = match first {
                None => Value::String(String::new()),
                Some(idx) => {
                    let start = idx.saturating_sub(80);
                    let end = (idx + q_len + 80).min(sc.collapsed.len());
                    let mut s = String::with_capacity(end - start + 6);
                    if start > 0 {
                        s.push('…');
                    }
                    if let Ok(slice) = std::str::from_utf8(&sc.collapsed[start..end]) {
                        s.push_str(slice);
                    }
                    if end < sc.collapsed.len() {
                        s.push('…');
                    }
                    Value::String(s)
                }
            };
            (occ, snip)
        } else {
            let collapsed = collapse_ws(body);
            let lower = collapsed.to_lowercase();
            let (first, occ) = count_capped(lower.as_bytes(), q_len, &finder);
            if !title_match && occ == 0 {
                return None;
            }
            let snip = first.map_or_else(
                || Value::String(String::new()),
                |idx| unicode_snippet(&collapsed, &lower, idx, q_u16),
            );
            (occ, snip)
        };

        let mut obj = Map::with_capacity(3);
        obj.insert("index".into(), json!(index));
        obj.insert(
            "score".into(),
            json!(if title_match { 100 } else { 0 } + occurrences * 10),
        );
        obj.insert("snippet".into(), snippet);
        Some(Value::Object(obj))
    }))
}

/// Port of `filterNoteTexts` (`plugins/notes/src/note-ops.ts:90`).
pub fn filter_note_texts(
    titles: Vec<String>,
    bodies: Vec<String>,
    query: String,
) -> Result<Vec<f64>, String> {
    let count = titles.len().min(bodies.len());
    if count == 0 {
        return Ok(Vec::new());
    }
    let lower_query = query.trim_matches(is_js_ws).to_lowercase();
    if lower_query.is_empty() {
        return Ok((0..count).map(|i| i as f64).collect());
    }
    let q_ascii = lower_query.is_ascii();
    let q_nl = lower_query.contains('\n');
    let q_len = lower_query.len();
    let finder = Finder::new(lower_query.as_bytes());

    Ok(run_batch(&titles, &bodies, |buf: &mut Vec<u8>, index| {
        let (title, body) = (&titles[index], &bodies[index]);
        let matched = if q_ascii && title.is_ascii() && body.is_ascii() {
            if !q_nl {
                (title.len() >= q_len && {
                    lower_ascii_into(title.as_bytes(), buf);
                    finder.find(buf).is_some()
                }) || (body.len() >= q_len && {
                    lower_ascii_into(body.as_bytes(), buf);
                    finder.find(buf).is_some()
                })
            } else {
                buf.clear();
                buf.reserve((title.len() + 1 + body.len()).saturating_sub(buf.capacity()));
                buf.extend(title.bytes().map(|b| b.to_ascii_lowercase()));
                buf.push(b'\n');
                buf.extend(body.bytes().map(|b| b.to_ascii_lowercase()));
                finder.find(buf).is_some()
            }
        } else {
            let combined = format!("{title}\n{body}").to_lowercase();
            finder.find(combined.as_bytes()).is_some()
        };
        matched.then_some(index as f64)
    }))
}
