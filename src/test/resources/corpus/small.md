# Project notes

This is a short document with the usual Markdown blocks. It is used to measure the load
time of a small file and to check that a mode switch does not change the text.

## Setup

1. Install the tools.
2. Run the build:

   ```bash
   ./gradlew buildPlugin
   ```

3. Open the IDE.

## Features

- **Source** mode: the normal text editor.
- **Edit** mode: a formatted view where you edit the document directly.
- A toolbar toggle and a shortcut switch the modes.

> Fidelity first: Edit mode must not rewrite text that you did not change.

### Table

| Metric | Target | Notes |
|:-------|-------:|-------|
| Cold open | 1.5 s | First Edit mode |
| Warm open | 300 ms | 5 000 lines |
| Keystroke | 16 ms | One frame |

### Code

```kotlin
class MdEditor(private val project: Project) {
    fun toggle() = Unit
}
```

Inline `code`, *emphasis*, _underscore emphasis_, **strong**, and ~~strike~~.
A [link](https://example.com) and a [reference link][docs].

---

## Tasks

- [x] Span capture
- [ ] Identity diff
- [ ] Outbox

## Details

Paragraph with a hard break at the end  
and a second line.

Another paragraph that is long enough to wrap in the view. It has several sentences. The
sentences are about nothing in particular. They only make the paragraph longer, so that
the layout has some work to do.

* Star bullet one
* Star bullet two
  * Nested bullet
  * Another nested bullet

1) Paren ordered
2) Second

<!-- An HTML comment that must stay as it is. -->

<details>
<summary>More</summary>

Hidden text.

</details>

## Open questions

- Which shortcuts reach the page?
- Is the compiled-script cache useful?
- How long does `huge.md` take to open?

> **Note**
> The answers go in `docs/milestones/M0.md`.

```json
{ "metric": "editModeColdOpenMs", "ms": 1200 }
```

Setext heading
--------------

Final paragraph with an image: ![logo](./logo.png "Logo").

[docs]: https://example.com/docs "Documentation"
