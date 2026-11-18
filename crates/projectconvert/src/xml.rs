//! A small, fast XML reader for project files — the Rust twin of
//! `src/main/lib/projectconvert/xml.ts`.
//!
//! Handles what DAW project files contain: elements, attributes, self-closing
//! tags, comments, processing instructions, CDATA, the five entities and
//! numeric references. DAWs put nearly everything in attributes, so text is
//! kept but rarely used.

#[derive(Debug, Clone, Default)]
pub struct Node {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
    pub text: String,
}

impl Node {
    pub fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// Follow a path of child names.
    pub fn path(&self, names: &[&str]) -> Option<&Node> {
        let mut current = self;
        for name in names {
            current = current.child(name)?;
        }
        Some(current)
    }

    /// Every descendant with this name, depth first, not descending into matches.
    pub fn find_all<'a>(&'a self, name: &str) -> Vec<&'a Node> {
        let mut out = Vec::new();
        self.find_all_into(name, &mut out);
        out
    }

    fn find_all_into<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        for c in &self.children {
            if c.name == name {
                out.push(c);
            } else {
                c.find_all_into(name, out);
            }
        }
    }

    /// Ableton's `<Thing Value="..."/>` idiom, after following `names`.
    pub fn value(&self, names: &[&str]) -> Option<&str> {
        self.path(names)?.attr("Value")
    }
}

/// Helpers that accept an optional node, like the TypeScript versions.
pub fn opt_path<'a>(node: Option<&'a Node>, names: &[&str]) -> Option<&'a Node> {
    node?.path(names)
}

pub fn opt_value<'a>(node: Option<&'a Node>, names: &[&str]) -> Option<&'a str> {
    node?.value(names)
}

pub fn opt_find_all<'a>(node: Option<&'a Node>, name: &str) -> Vec<&'a Node> {
    node.map(|n| n.find_all(name)).unwrap_or_default()
}

/// parseFloat-like: leading number, else the fallback.
pub fn num(raw: Option<&str>, fallback: f64) -> f64 {
    let Some(s) = raw else { return fallback };
    let s = s.trim_start();
    let bytes = s.as_bytes();
    let mut end = 0;
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_exp = false;
    while end < bytes.len() {
        let c = bytes[end];
        match c {
            b'0'..=b'9' => seen_digit = true,
            b'+' | b'-' if end == 0 || matches!(bytes[end - 1], b'e' | b'E') => {}
            b'.' if !seen_dot && !seen_exp => seen_dot = true,
            b'e' | b'E' if seen_digit && !seen_exp => seen_exp = true,
            _ => break,
        }
        end += 1;
    }
    // Trim a dangling exponent or sign.
    let mut slice = &s[..end];
    while let Some(last) = slice.chars().last() {
        if matches!(last, 'e' | 'E' | '+' | '-') {
            slice = &slice[..slice.len() - 1];
        } else {
            break;
        }
    }
    match slice.parse::<f64>() {
        Ok(v) if v.is_finite() => v,
        _ => fallback,
    }
}

fn decode(value: &str) -> String {
    if !value.contains('&') {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(semi) = after.find(';').filter(|&s| s <= 10) {
            let body = &after[..semi];
            let decoded = match body {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ if body.starts_with("#x") || body.starts_with("#X") => {
                    u32::from_str_radix(&body[2..], 16).ok().and_then(char::from_u32)
                }
                _ if body.starts_with('#') => body[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(c) = decoded {
                out.push(c);
                rest = &after[semi + 1..];
                continue;
            }
        }
        out.push('&');
        rest = after;
    }
    out.push_str(rest);
    out
}

/// The closing `>` of a tag, skipping any `>` inside quoted attribute values.
fn find_tag_end(bytes: &[u8], from: usize) -> Option<usize> {
    let mut quote = 0u8;
    for (i, &c) in bytes.iter().enumerate().skip(from) {
        if quote != 0 {
            if c == quote {
                quote = 0;
            }
        } else if c == b'"' || c == b'\'' {
            quote = c;
        } else if c == b'>' {
            return Some(i);
        }
    }
    None
}

fn parse_attrs(inner: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = inner.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let key_start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' && b[i] != b'>' {
            i += 1;
        }
        let key = &inner[key_start..i];
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != b'=' {
            if key.is_empty() {
                i += 1;
            }
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || (b[i] != b'"' && b[i] != b'\'') {
            continue;
        }
        let q = b[i];
        let vstart = i + 1;
        let Some(rel) = b[vstart..].iter().position(|&c| c == q) else { break };
        let vend = vstart + rel;
        if !key.is_empty() {
            out.push((key.to_string(), decode(&inner[vstart..vend])));
        }
        i = vend + 1;
    }
    out
}

pub fn parse(text: &str) -> Node {
    let mut stack: Vec<Node> = vec![Node { name: "#document".into(), ..Default::default() }];
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut pos = 0;

    while pos < len {
        let Some(rel) = text[pos..].find('<') else { break };
        let lt = pos + rel;
        if lt > pos {
            let chunk = &text[pos..lt];
            if !chunk.trim().is_empty() {
                let top = stack.last_mut().unwrap();
                top.text.push_str(&decode(chunk));
            }
        }
        let rest = &text[lt..];
        if let Some(after) = rest.strip_prefix("<!--") {
            pos = after.find("-->").map(|e| lt + 4 + e + 3).unwrap_or(len);
            continue;
        }
        if let Some(after) = rest.strip_prefix("<![CDATA[") {
            let end = after.find("]]>").map(|e| lt + 9 + e);
            let content_end = end.unwrap_or(len);
            stack.last_mut().unwrap().text.push_str(&text[lt + 9..content_end]);
            pos = end.map(|e| e + 3).unwrap_or(len);
            continue;
        }
        if lt + 1 < len && (bytes[lt + 1] == b'?' || bytes[lt + 1] == b'!') {
            pos = text[lt + 1..].find('>').map(|e| lt + 1 + e + 1).unwrap_or(len);
            continue;
        }
        let Some(gt) = find_tag_end(bytes, lt + 1) else { break };

        if lt + 1 < len && bytes[lt + 1] == b'/' {
            let name = text[lt + 2..gt].trim();
            if let Some(i) = stack.iter().rposition(|n| n.name == name) {
                if i > 0 {
                    while stack.len() > i {
                        let node = stack.pop().unwrap();
                        stack.last_mut().unwrap().children.push(node);
                    }
                }
            }
            pos = gt + 1;
            continue;
        }

        let self_closing = bytes[gt - 1] == b'/';
        let inner = &text[lt + 1..if self_closing { gt - 1 } else { gt }];
        let name_end = inner.find(|c: char| c.is_whitespace() || c == '/').unwrap_or(inner.len());
        let node = Node {
            name: inner[..name_end].to_string(),
            attrs: if name_end < inner.len() { parse_attrs(&inner[name_end..]) } else { Vec::new() },
            children: Vec::new(),
            text: String::new(),
        };
        if self_closing {
            stack.last_mut().unwrap().children.push(node);
        } else {
            stack.push(node);
        }
        pos = gt + 1;
    }

    while stack.len() > 1 {
        let node = stack.pop().unwrap();
        stack.last_mut().unwrap().children.push(node);
    }
    stack.pop().unwrap()
}

/* ------------------------------ writing ---------------------------- */

pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' => {}
            _ => out.push(c),
        }
    }
    out
}

/// ` key="value"` pairs, skipping `None`.
pub fn attrs(pairs: &[(&str, Option<String>)]) -> String {
    let mut out = String::new();
    for (k, v) in pairs {
        if let Some(v) = v {
            out.push(' ');
            out.push_str(k);
            out.push_str("=\"");
            out.push_str(&escape(v));
            out.push('"');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entities_self_closing_and_quoted_gt() {
        let doc = parse("<?xml version=\"1.0\"?><!-- c --><a x=\"1 &gt; 0\"><b y='2'/><c>t&amp;u</c></a>");
        let a = &doc.children[0];
        assert_eq!(a.attr("x"), Some("1 > 0"));
        assert_eq!(a.children[0].attr("y"), Some("2"));
        assert_eq!(a.children[1].text, "t&u");
    }

    #[test]
    fn num_matches_parse_float() {
        assert_eq!(num(Some("120.5abc"), 0.0), 120.5);
        assert_eq!(num(Some("-63072000"), 0.0), -63072000.0);
        assert_eq!(num(Some("1e3"), 0.0), 1000.0);
        assert_eq!(num(Some("x"), 7.0), 7.0);
        assert_eq!(num(None, 7.0), 7.0);
    }
}
