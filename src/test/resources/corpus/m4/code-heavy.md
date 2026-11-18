# Code-heavy document (M4)

## Example 1 (ts)

A short calculation gives the result. Consider the general case. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```ts
interface Item0 {
  id: number;
  name: string;
}

export async function load0(url: string): Promise<Item0[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item0[];
  return items.filter((i) => i.id > 0).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 2 (python)

This follows from the lemma. A short calculation gives the result. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item1:
    id: int
    name: str

def load_1(path: str) -> list[Item1]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item1(**d) for d in data if d["id"] > 1]
```

## Example 3 (java)

We now look at the bound. Note that the series is absolutely convergent. Consider the general case. A short calculation gives the result.

```java
public final class Service2 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service2" + counts;
    }
}
```

## Example 4 (kotlin)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. This follows from the lemma.

```kotlin
data class Item3(val id: Int, val name: String)

fun process3(items: List<Item3>): Map<Int, String> =
    items.filter { it.id > 3 }
        .associate { it.id to it.name.uppercase() }
```

## Example 5 (rust)

A short calculation gives the result. The value converges quickly. This follows from the lemma. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_4(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 6 (go)

Consider the general case. A short calculation gives the result. We now look at the bound. This follows from the lemma. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```go
package main

import "fmt"

func sum5(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum5([]int{1, 2, 3})) }
```

## Example 7 (bash)

A short calculation gives the result. Consider the general case. A short calculation gives the result.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (6)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 8 (json)

This follows from the lemma. A short calculation gives the result. Consider the general case. We now look at the bound. Consider the general case. We now look at the bound.

```json
{
  "name": "pkg-7",
  "version": "1.0.7",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 9 (yaml)

A short calculation gives the result. The value converges quickly. Note that the series is absolutely convergent.

```yaml
name: build-8
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 10 (sql)

The value converges quickly. This follows from the lemma. This follows from the lemma. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 19;
```

## Example 11 (css)

Consider the general case. We now look at the bound. A short calculation gives the result. This follows from the lemma. We now look at the bound.

```css
.card-10 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 10px;
}
.card-10:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 12 (html)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case. Consider the general case.

```html
<section class="hero-11">
  <h1>Title 11</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 13 (ts)

The value converges quickly. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. The value converges quickly. Consider the general case.

```ts
interface Item12 {
  id: number;
  name: string;
}

export async function load12(url: string): Promise<Item12[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item12[];
  return items.filter((i) => i.id > 12).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 14 (python)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item13:
    id: int
    name: str

def load_13(path: str) -> list[Item13]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item13(**d) for d in data if d["id"] > 13]
```

## Example 15 (java)

A short calculation gives the result. A short calculation gives the result. We now look at the bound. The value converges quickly. Consider the general case. This follows from the lemma.

```java
public final class Service14 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service14" + counts;
    }
}
```

## Example 16 (kotlin)

A short calculation gives the result. The value converges quickly. The value converges quickly. Consider the general case.

```kotlin
data class Item15(val id: Int, val name: String)

fun process15(items: List<Item15>): Map<Int, String> =
    items.filter { it.id > 15 }
        .associate { it.id to it.name.uppercase() }
```

## Example 17 (rust)

Note that the series is absolutely convergent. This follows from the lemma. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_16(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 18 (go)

Note that the series is absolutely convergent. A short calculation gives the result. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum17(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum17([]int{1, 2, 3})) }
```

## Example 19 (bash)

This follows from the lemma. Consider the general case. Consider the general case. The value converges quickly. A short calculation gives the result.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (18)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 20 (json)

With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. Note that the series is absolutely convergent. This follows from the lemma.

```json
{
  "name": "pkg-19",
  "version": "1.0.19",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 21 (yaml)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma.

```yaml
name: build-20
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 22 (sql)

Consider the general case. The value converges quickly. A short calculation gives the result.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 31;
```

## Example 23 (css)

This follows from the lemma. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```css
.card-22 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 22px;
}
.card-22:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 24 (html)

A short calculation gives the result. This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound.

```html
<section class="hero-23">
  <h1>Title 23</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 25 (ts)

A short calculation gives the result. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. We now look at the bound.

```ts
interface Item24 {
  id: number;
  name: string;
}

export async function load24(url: string): Promise<Item24[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item24[];
  return items.filter((i) => i.id > 24).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 26 (python)

This follows from the lemma. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item25:
    id: int
    name: str

def load_25(path: str) -> list[Item25]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item25(**d) for d in data if d["id"] > 25]
```

## Example 27 (java)

The value converges quickly. Note that the series is absolutely convergent. This follows from the lemma. Consider the general case. Consider the general case.

```java
public final class Service26 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service26" + counts;
    }
}
```

## Example 28 (kotlin)

A short calculation gives the result. A short calculation gives the result. The value converges quickly. This follows from the lemma. Consider the general case.

```kotlin
data class Item27(val id: Int, val name: String)

fun process27(items: List<Item27>): Map<Int, String> =
    items.filter { it.id > 27 }
        .associate { it.id to it.name.uppercase() }
```

## Example 29 (rust)

The value converges quickly. We now look at the bound. The value converges quickly. A short calculation gives the result. Note that the series is absolutely convergent.

```rust
use std::collections::HashMap;

pub fn count_28(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 30 (go)

This follows from the lemma. The value converges quickly. We now look at the bound.

```go
package main

import "fmt"

func sum29(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum29([]int{1, 2, 3})) }
```

## Example 31 (bash)

Consider the general case. The value converges quickly. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (30)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 32 (json)

This follows from the lemma. Consider the general case. This follows from the lemma. Note that the series is absolutely convergent. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-31",
  "version": "1.0.31",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 33 (yaml)

We now look at the bound. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. This follows from the lemma.

```yaml
name: build-32
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 34 (sql)

Consider the general case. We now look at the bound. A short calculation gives the result. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 43;
```

## Example 35 (css)

The value converges quickly. This follows from the lemma. We now look at the bound. A short calculation gives the result. A short calculation gives the result. A short calculation gives the result.

```css
.card-34 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 34px;
}
.card-34:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 36 (html)

We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```html
<section class="hero-35">
  <h1>Title 35</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 37 (ts)

Consider the general case. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Consider the general case. This follows from the lemma.

```ts
interface Item36 {
  id: number;
  name: string;
}

export async function load36(url: string): Promise<Item36[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item36[];
  return items.filter((i) => i.id > 36).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 38 (python)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item37:
    id: int
    name: str

def load_37(path: str) -> list[Item37]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item37(**d) for d in data if d["id"] > 37]
```

## Example 39 (java)

Consider the general case. We now look at the bound. Note that the series is absolutely convergent. Consider the general case.

```java
public final class Service38 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service38" + counts;
    }
}
```

## Example 40 (kotlin)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. A short calculation gives the result. We now look at the bound.

```kotlin
data class Item39(val id: Int, val name: String)

fun process39(items: List<Item39>): Map<Int, String> =
    items.filter { it.id > 39 }
        .associate { it.id to it.name.uppercase() }
```

## Example 41 (rust)

A short calculation gives the result. Note that the series is absolutely convergent. We now look at the bound. The value converges quickly.

```rust
use std::collections::HashMap;

pub fn count_40(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 42 (go)

The value converges quickly. This follows from the lemma. We now look at the bound.

```go
package main

import "fmt"

func sum41(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum41([]int{1, 2, 3})) }
```

## Example 43 (bash)

The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. The value converges quickly. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (42)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 44 (json)

Note that the series is absolutely convergent. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Note that the series is absolutely convergent.

```json
{
  "name": "pkg-43",
  "version": "1.0.43",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 45 (yaml)

A short calculation gives the result. Consider the general case. This follows from the lemma. A short calculation gives the result.

```yaml
name: build-44
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 46 (sql)

This follows from the lemma. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 55;
```

## Example 47 (css)

With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. We now look at the bound.

```css
.card-46 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 46px;
}
.card-46:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 48 (html)

This follows from the lemma. Note that the series is absolutely convergent. This follows from the lemma. The value converges quickly.

```html
<section class="hero-47">
  <h1>Title 47</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 49 (ts)

We now look at the bound. We now look at the bound. We now look at the bound. This follows from the lemma. The value converges quickly.

```ts
interface Item48 {
  id: number;
  name: string;
}

export async function load48(url: string): Promise<Item48[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item48[];
  return items.filter((i) => i.id > 48).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 50 (python)

With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item49:
    id: int
    name: str

def load_49(path: str) -> list[Item49]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item49(**d) for d in data if d["id"] > 49]
```

## Example 51 (java)

A short calculation gives the result. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. Consider the general case. This follows from the lemma.

```java
public final class Service50 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service50" + counts;
    }
}
```

## Example 52 (kotlin)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. We now look at the bound. We now look at the bound. We now look at the bound. We now look at the bound.

```kotlin
data class Item51(val id: Int, val name: String)

fun process51(items: List<Item51>): Map<Int, String> =
    items.filter { it.id > 51 }
        .associate { it.id to it.name.uppercase() }
```

## Example 53 (rust)

This follows from the lemma. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. A short calculation gives the result.

```rust
use std::collections::HashMap;

pub fn count_52(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 54 (go)

Note that the series is absolutely convergent. The value converges quickly. A short calculation gives the result. Consider the general case.

```go
package main

import "fmt"

func sum53(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum53([]int{1, 2, 3})) }
```

## Example 55 (bash)

Note that the series is absolutely convergent. This follows from the lemma. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (54)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 56 (json)

We now look at the bound. Note that the series is absolutely convergent. Consider the general case. We now look at the bound. We now look at the bound. Note that the series is absolutely convergent.

```json
{
  "name": "pkg-55",
  "version": "1.0.55",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 57 (yaml)

Note that the series is absolutely convergent. Consider the general case. The value converges quickly.

```yaml
name: build-56
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 58 (sql)

We now look at the bound. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. The value converges quickly.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 67;
```

## Example 59 (css)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```css
.card-58 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 58px;
}
.card-58:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 60 (html)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. The value converges quickly. We now look at the bound.

```html
<section class="hero-59">
  <h1>Title 59</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 61 (ts)

Consider the general case. This follows from the lemma. We now look at the bound. We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item60 {
  id: number;
  name: string;
}

export async function load60(url: string): Promise<Item60[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item60[];
  return items.filter((i) => i.id > 60).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 62 (python)

This follows from the lemma. The value converges quickly. The value converges quickly. The value converges quickly. This follows from the lemma.

```python
import json
from dataclasses import dataclass

@dataclass
class Item61:
    id: int
    name: str

def load_61(path: str) -> list[Item61]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item61(**d) for d in data if d["id"] > 61]
```

## Example 63 (java)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```java
public final class Service62 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service62" + counts;
    }
}
```

## Example 64 (kotlin)

Note that the series is absolutely convergent. We now look at the bound. This follows from the lemma.

```kotlin
data class Item63(val id: Int, val name: String)

fun process63(items: List<Item63>): Map<Int, String> =
    items.filter { it.id > 63 }
        .associate { it.id to it.name.uppercase() }
```

## Example 65 (rust)

A short calculation gives the result. A short calculation gives the result. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_64(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 66 (go)

We now look at the bound. The value converges quickly. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```go
package main

import "fmt"

func sum65(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum65([]int{1, 2, 3})) }
```

## Example 67 (bash)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. This follows from the lemma.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (66)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 68 (json)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```json
{
  "name": "pkg-67",
  "version": "1.0.67",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 69 (yaml)

Note that the series is absolutely convergent. Consider the general case. A short calculation gives the result.

```yaml
name: build-68
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 70 (sql)

We now look at the bound. This follows from the lemma. This follows from the lemma. A short calculation gives the result.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 79;
```

## Example 71 (css)

We now look at the bound. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. The value converges quickly.

```css
.card-70 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 70px;
}
.card-70:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 72 (html)

A short calculation gives the result. Consider the general case. A short calculation gives the result. We now look at the bound.

```html
<section class="hero-71">
  <h1>Title 71</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 73 (ts)

A short calculation gives the result. Note that the series is absolutely convergent. The value converges quickly. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```ts
interface Item72 {
  id: number;
  name: string;
}

export async function load72(url: string): Promise<Item72[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item72[];
  return items.filter((i) => i.id > 72).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 74 (python)

Note that the series is absolutely convergent. We now look at the bound. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item73:
    id: int
    name: str

def load_73(path: str) -> list[Item73]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item73(**d) for d in data if d["id"] > 73]
```

## Example 75 (java)

The value converges quickly. A short calculation gives the result. Consider the general case. The value converges quickly. Note that the series is absolutely convergent. The value converges quickly.

```java
public final class Service74 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service74" + counts;
    }
}
```

## Example 76 (kotlin)

Consider the general case. The value converges quickly. Note that the series is absolutely convergent.

```kotlin
data class Item75(val id: Int, val name: String)

fun process75(items: List<Item75>): Map<Int, String> =
    items.filter { it.id > 75 }
        .associate { it.id to it.name.uppercase() }
```

## Example 77 (rust)

The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_76(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 78 (go)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Consider the general case. A short calculation gives the result. The value converges quickly.

```go
package main

import "fmt"

func sum77(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum77([]int{1, 2, 3})) }
```

## Example 79 (bash)

Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (78)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 80 (json)

Consider the general case. This follows from the lemma. Note that the series is absolutely convergent.

```json
{
  "name": "pkg-79",
  "version": "1.0.79",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 81 (yaml)

Note that the series is absolutely convergent. Consider the general case. Note that the series is absolutely convergent.

```yaml
name: build-80
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 82 (sql)

We now look at the bound. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 91;
```

## Example 83 (css)

A short calculation gives the result. This follows from the lemma. A short calculation gives the result.

```css
.card-82 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 82px;
}
.card-82:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 84 (html)

Note that the series is absolutely convergent. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```html
<section class="hero-83">
  <h1>Title 83</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 85 (ts)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound. Consider the general case.

```ts
interface Item84 {
  id: number;
  name: string;
}

export async function load84(url: string): Promise<Item84[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item84[];
  return items.filter((i) => i.id > 84).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 86 (python)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. The value converges quickly. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item85:
    id: int
    name: str

def load_85(path: str) -> list[Item85]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item85(**d) for d in data if d["id"] > 85]
```

## Example 87 (java)

A short calculation gives the result. This follows from the lemma. A short calculation gives the result.

```java
public final class Service86 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service86" + counts;
    }
}
```

## Example 88 (kotlin)

The value converges quickly. A short calculation gives the result. This follows from the lemma. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```kotlin
data class Item87(val id: Int, val name: String)

fun process87(items: List<Item87>): Map<Int, String> =
    items.filter { it.id > 87 }
        .associate { it.id to it.name.uppercase() }
```

## Example 89 (rust)

The value converges quickly. This follows from the lemma. Note that the series is absolutely convergent. Note that the series is absolutely convergent. This follows from the lemma.

```rust
use std::collections::HashMap;

pub fn count_88(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 90 (go)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case. A short calculation gives the result.

```go
package main

import "fmt"

func sum89(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum89([]int{1, 2, 3})) }
```

## Example 91 (bash)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Note that the series is absolutely convergent. We now look at the bound. We now look at the bound. The value converges quickly.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (90)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 92 (json)

Note that the series is absolutely convergent. A short calculation gives the result. We now look at the bound. We now look at the bound.

```json
{
  "name": "pkg-91",
  "version": "1.0.91",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 93 (yaml)

This follows from the lemma. The value converges quickly. Note that the series is absolutely convergent. The value converges quickly. Note that the series is absolutely convergent. We now look at the bound.

```yaml
name: build-92
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 94 (sql)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 103;
```

## Example 95 (css)

Note that the series is absolutely convergent. This follows from the lemma. This follows from the lemma. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```css
.card-94 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 94px;
}
.card-94:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 96 (html)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. This follows from the lemma. Consider the general case.

```html
<section class="hero-95">
  <h1>Title 95</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 97 (ts)

A short calculation gives the result. This follows from the lemma. Consider the general case. The value converges quickly. This follows from the lemma.

```ts
interface Item96 {
  id: number;
  name: string;
}

export async function load96(url: string): Promise<Item96[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item96[];
  return items.filter((i) => i.id > 96).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 98 (python)

Note that the series is absolutely convergent. Consider the general case. Consider the general case. The value converges quickly. Consider the general case. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item97:
    id: int
    name: str

def load_97(path: str) -> list[Item97]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item97(**d) for d in data if d["id"] > 97]
```

## Example 99 (java)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. A short calculation gives the result. We now look at the bound. The value converges quickly. We now look at the bound.

```java
public final class Service98 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service98" + counts;
    }
}
```

## Example 100 (kotlin)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. This follows from the lemma. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```kotlin
data class Item99(val id: Int, val name: String)

fun process99(items: List<Item99>): Map<Int, String> =
    items.filter { it.id > 99 }
        .associate { it.id to it.name.uppercase() }
```

## Example 101 (rust)

With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```rust
use std::collections::HashMap;

pub fn count_100(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 102 (go)

A short calculation gives the result. We now look at the bound. This follows from the lemma. The value converges quickly. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum101(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum101([]int{1, 2, 3})) }
```

## Example 103 (bash)

A short calculation gives the result. Note that the series is absolutely convergent. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (102)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 104 (json)

A short calculation gives the result. The value converges quickly. We now look at the bound. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-103",
  "version": "1.0.103",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 105 (yaml)

A short calculation gives the result. Consider the general case. The value converges quickly. Consider the general case. A short calculation gives the result.

```yaml
name: build-104
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 106 (sql)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. The value converges quickly. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 115;
```

## Example 107 (css)

A short calculation gives the result. Note that the series is absolutely convergent. This follows from the lemma. We now look at the bound. We now look at the bound. A short calculation gives the result.

```css
.card-106 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 106px;
}
.card-106:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 108 (html)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. A short calculation gives the result.

```html
<section class="hero-107">
  <h1>Title 107</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 109 (ts)

The value converges quickly. Consider the general case. Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item108 {
  id: number;
  name: string;
}

export async function load108(url: string): Promise<Item108[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item108[];
  return items.filter((i) => i.id > 108).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 110 (python)

This follows from the lemma. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item109:
    id: int
    name: str

def load_109(path: str) -> list[Item109]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item109(**d) for d in data if d["id"] > 109]
```

## Example 111 (java)

Note that the series is absolutely convergent. The value converges quickly. The value converges quickly. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```java
public final class Service110 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service110" + counts;
    }
}
```

## Example 112 (kotlin)

This follows from the lemma. Consider the general case. We now look at the bound.

```kotlin
data class Item111(val id: Int, val name: String)

fun process111(items: List<Item111>): Map<Int, String> =
    items.filter { it.id > 111 }
        .associate { it.id to it.name.uppercase() }
```

## Example 113 (rust)

The value converges quickly. A short calculation gives the result. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```rust
use std::collections::HashMap;

pub fn count_112(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 114 (go)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. We now look at the bound. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum113(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum113([]int{1, 2, 3})) }
```

## Example 115 (bash)

Consider the general case. The value converges quickly. Note that the series is absolutely convergent. We now look at the bound. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (114)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 116 (json)

Note that the series is absolutely convergent. We now look at the bound. The value converges quickly. The value converges quickly.

```json
{
  "name": "pkg-115",
  "version": "1.0.115",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 117 (yaml)

Consider the general case. A short calculation gives the result. Consider the general case. The value converges quickly. Consider the general case.

```yaml
name: build-116
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 118 (sql)

We now look at the bound. This follows from the lemma. A short calculation gives the result.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 127;
```

## Example 119 (css)

The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. This follows from the lemma.

```css
.card-118 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 118px;
}
.card-118:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 120 (html)

The value converges quickly. Note that the series is absolutely convergent. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Note that the series is absolutely convergent.

```html
<section class="hero-119">
  <h1>Title 119</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 121 (ts)

We now look at the bound. The value converges quickly. This follows from the lemma. The value converges quickly. A short calculation gives the result. This follows from the lemma.

```ts
interface Item120 {
  id: number;
  name: string;
}

export async function load120(url: string): Promise<Item120[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item120[];
  return items.filter((i) => i.id > 120).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 122 (python)

Consider the general case. A short calculation gives the result. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item121:
    id: int
    name: str

def load_121(path: str) -> list[Item121]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item121(**d) for d in data if d["id"] > 121]
```

## Example 123 (java)

Consider the general case. We now look at the bound. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```java
public final class Service122 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service122" + counts;
    }
}
```

## Example 124 (kotlin)

Consider the general case. A short calculation gives the result. The value converges quickly. The value converges quickly. The value converges quickly. This follows from the lemma.

```kotlin
data class Item123(val id: Int, val name: String)

fun process123(items: List<Item123>): Map<Int, String> =
    items.filter { it.id > 123 }
        .associate { it.id to it.name.uppercase() }
```

## Example 125 (rust)

This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_124(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 126 (go)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. A short calculation gives the result. A short calculation gives the result. A short calculation gives the result. This follows from the lemma.

```go
package main

import "fmt"

func sum125(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum125([]int{1, 2, 3})) }
```

## Example 127 (bash)

Consider the general case. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. Consider the general case.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (126)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 128 (json)

We now look at the bound. The value converges quickly. We now look at the bound. A short calculation gives the result.

```json
{
  "name": "pkg-127",
  "version": "1.0.127",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 129 (yaml)

We now look at the bound. This follows from the lemma. A short calculation gives the result.

```yaml
name: build-128
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 130 (sql)

Consider the general case. We now look at the bound. This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 139;
```

## Example 131 (css)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. We now look at the bound. Consider the general case.

```css
.card-130 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 130px;
}
.card-130:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 132 (html)

With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```html
<section class="hero-131">
  <h1>Title 131</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 133 (ts)

The value converges quickly. Consider the general case. Note that the series is absolutely convergent. Consider the general case.

```ts
interface Item132 {
  id: number;
  name: string;
}

export async function load132(url: string): Promise<Item132[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item132[];
  return items.filter((i) => i.id > 132).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 134 (python)

Note that the series is absolutely convergent. Consider the general case. This follows from the lemma. This follows from the lemma.

```python
import json
from dataclasses import dataclass

@dataclass
class Item133:
    id: int
    name: str

def load_133(path: str) -> list[Item133]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item133(**d) for d in data if d["id"] > 133]
```

## Example 135 (java)

We now look at the bound. Note that the series is absolutely convergent. This follows from the lemma.

```java
public final class Service134 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service134" + counts;
    }
}
```

## Example 136 (kotlin)

We now look at the bound. This follows from the lemma. This follows from the lemma.

```kotlin
data class Item135(val id: Int, val name: String)

fun process135(items: List<Item135>): Map<Int, String> =
    items.filter { it.id > 135 }
        .associate { it.id to it.name.uppercase() }
```

## Example 137 (rust)

A short calculation gives the result. We now look at the bound. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_136(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 138 (go)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. A short calculation gives the result. A short calculation gives the result. We now look at the bound.

```go
package main

import "fmt"

func sum137(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum137([]int{1, 2, 3})) }
```

## Example 139 (bash)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (138)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 140 (json)

The value converges quickly. A short calculation gives the result. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```json
{
  "name": "pkg-139",
  "version": "1.0.139",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 141 (yaml)

Note that the series is absolutely convergent. The value converges quickly. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent. The value converges quickly.

```yaml
name: build-140
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 142 (sql)

A short calculation gives the result. A short calculation gives the result. Note that the series is absolutely convergent.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 151;
```

## Example 143 (css)

Consider the general case. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. We now look at the bound. A short calculation gives the result.

```css
.card-142 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 142px;
}
.card-142:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 144 (html)

This follows from the lemma. A short calculation gives the result. We now look at the bound. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```html
<section class="hero-143">
  <h1>Title 143</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 145 (ts)

The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item144 {
  id: number;
  name: string;
}

export async function load144(url: string): Promise<Item144[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item144[];
  return items.filter((i) => i.id > 144).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 146 (python)

The value converges quickly. This follows from the lemma. This follows from the lemma. Note that the series is absolutely convergent. Consider the general case. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item145:
    id: int
    name: str

def load_145(path: str) -> list[Item145]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item145(**d) for d in data if d["id"] > 145]
```

## Example 147 (java)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. Note that the series is absolutely convergent. The value converges quickly. We now look at the bound. Note that the series is absolutely convergent.

```java
public final class Service146 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service146" + counts;
    }
}
```

## Example 148 (kotlin)

We now look at the bound. We now look at the bound. Note that the series is absolutely convergent. A short calculation gives the result.

```kotlin
data class Item147(val id: Int, val name: String)

fun process147(items: List<Item147>): Map<Int, String> =
    items.filter { it.id > 147 }
        .associate { it.id to it.name.uppercase() }
```

## Example 149 (rust)

The value converges quickly. The value converges quickly. The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_148(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 150 (go)

With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. This follows from the lemma. The value converges quickly. We now look at the bound.

```go
package main

import "fmt"

func sum149(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum149([]int{1, 2, 3})) }
```

## Example 151 (bash)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. The value converges quickly. We now look at the bound. The value converges quickly.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (150)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 152 (json)

We now look at the bound. Consider the general case. Consider the general case. The value converges quickly. A short calculation gives the result. This follows from the lemma.

```json
{
  "name": "pkg-151",
  "version": "1.0.151",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 153 (yaml)

This follows from the lemma. This follows from the lemma. Consider the general case. The value converges quickly. This follows from the lemma.

```yaml
name: build-152
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 154 (sql)

The value converges quickly. A short calculation gives the result. Consider the general case. Note that the series is absolutely convergent. Consider the general case.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 163;
```

## Example 155 (css)

This follows from the lemma. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Note that the series is absolutely convergent. The value converges quickly.

```css
.card-154 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 154px;
}
.card-154:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 156 (html)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. This follows from the lemma.

```html
<section class="hero-155">
  <h1>Title 155</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 157 (ts)

Consider the general case. A short calculation gives the result. Consider the general case. We now look at the bound.

```ts
interface Item156 {
  id: number;
  name: string;
}

export async function load156(url: string): Promise<Item156[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item156[];
  return items.filter((i) => i.id > 156).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 158 (python)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item157:
    id: int
    name: str

def load_157(path: str) -> list[Item157]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item157(**d) for d in data if d["id"] > 157]
```

## Example 159 (java)

We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. The value converges quickly.

```java
public final class Service158 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service158" + counts;
    }
}
```

## Example 160 (kotlin)

This follows from the lemma. We now look at the bound. The value converges quickly. We now look at the bound.

```kotlin
data class Item159(val id: Int, val name: String)

fun process159(items: List<Item159>): Map<Int, String> =
    items.filter { it.id > 159 }
        .associate { it.id to it.name.uppercase() }
```

## Example 161 (rust)

This follows from the lemma. Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_160(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 162 (go)

Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum161(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum161([]int{1, 2, 3})) }
```

## Example 163 (bash)

The value converges quickly. This follows from the lemma. A short calculation gives the result. Note that the series is absolutely convergent. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (162)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 164 (json)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. We now look at the bound. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```json
{
  "name": "pkg-163",
  "version": "1.0.163",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 165 (yaml)

Consider the general case. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. We now look at the bound.

```yaml
name: build-164
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 166 (sql)

Note that the series is absolutely convergent. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. Note that the series is absolutely convergent. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 175;
```

## Example 167 (css)

Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```css
.card-166 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 166px;
}
.card-166:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 168 (html)

Consider the general case. The value converges quickly. This follows from the lemma.

```html
<section class="hero-167">
  <h1>Title 167</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 169 (ts)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. The value converges quickly.

```ts
interface Item168 {
  id: number;
  name: string;
}

export async function load168(url: string): Promise<Item168[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item168[];
  return items.filter((i) => i.id > 168).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 170 (python)

A short calculation gives the result. The value converges quickly. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item169:
    id: int
    name: str

def load_169(path: str) -> list[Item169]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item169(**d) for d in data if d["id"] > 169]
```

## Example 171 (java)

The value converges quickly. We now look at the bound. We now look at the bound. This follows from the lemma.

```java
public final class Service170 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service170" + counts;
    }
}
```

## Example 172 (kotlin)

This follows from the lemma. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent.

```kotlin
data class Item171(val id: Int, val name: String)

fun process171(items: List<Item171>): Map<Int, String> =
    items.filter { it.id > 171 }
        .associate { it.id to it.name.uppercase() }
```

## Example 173 (rust)

A short calculation gives the result. The value converges quickly. This follows from the lemma.

```rust
use std::collections::HashMap;

pub fn count_172(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 174 (go)

We now look at the bound. A short calculation gives the result. Consider the general case. Consider the general case. A short calculation gives the result. A short calculation gives the result.

```go
package main

import "fmt"

func sum173(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum173([]int{1, 2, 3})) }
```

## Example 175 (bash)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (174)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 176 (json)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. We now look at the bound. Note that the series is absolutely convergent. This follows from the lemma.

```json
{
  "name": "pkg-175",
  "version": "1.0.175",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 177 (yaml)

We now look at the bound. This follows from the lemma. Note that the series is absolutely convergent. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```yaml
name: build-176
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 178 (sql)

A short calculation gives the result. This follows from the lemma. Note that the series is absolutely convergent. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 187;
```

## Example 179 (css)

A short calculation gives the result. Note that the series is absolutely convergent. We now look at the bound.

```css
.card-178 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 178px;
}
.card-178:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 180 (html)

With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Note that the series is absolutely convergent. The value converges quickly.

```html
<section class="hero-179">
  <h1>Title 179</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 181 (ts)

Consider the general case. We now look at the bound. The value converges quickly.

```ts
interface Item180 {
  id: number;
  name: string;
}

export async function load180(url: string): Promise<Item180[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item180[];
  return items.filter((i) => i.id > 180).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 182 (python)

We now look at the bound. The value converges quickly. The value converges quickly. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item181:
    id: int
    name: str

def load_181(path: str) -> list[Item181]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item181(**d) for d in data if d["id"] > 181]
```

## Example 183 (java)

The value converges quickly. Consider the general case. Consider the general case. Consider the general case.

```java
public final class Service182 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service182" + counts;
    }
}
```

## Example 184 (kotlin)

We now look at the bound. This follows from the lemma. This follows from the lemma.

```kotlin
data class Item183(val id: Int, val name: String)

fun process183(items: List<Item183>): Map<Int, String> =
    items.filter { it.id > 183 }
        .associate { it.id to it.name.uppercase() }
```

## Example 185 (rust)

Consider the general case. Consider the general case. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_184(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 186 (go)

Note that the series is absolutely convergent. A short calculation gives the result. A short calculation gives the result. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```go
package main

import "fmt"

func sum185(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum185([]int{1, 2, 3})) }
```

## Example 187 (bash)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. This follows from the lemma. Consider the general case. A short calculation gives the result.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (186)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 188 (json)

Consider the general case. We now look at the bound. This follows from the lemma. Consider the general case.

```json
{
  "name": "pkg-187",
  "version": "1.0.187",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 189 (yaml)

This follows from the lemma. A short calculation gives the result. The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```yaml
name: build-188
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 190 (sql)

This follows from the lemma. Note that the series is absolutely convergent. The value converges quickly. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 199;
```

## Example 191 (css)

We now look at the bound. We now look at the bound. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```css
.card-190 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 190px;
}
.card-190:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 192 (html)

Consider the general case. The value converges quickly. The value converges quickly. Consider the general case. The value converges quickly.

```html
<section class="hero-191">
  <h1>Title 191</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 193 (ts)

This follows from the lemma. This follows from the lemma. We now look at the bound. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma.

```ts
interface Item192 {
  id: number;
  name: string;
}

export async function load192(url: string): Promise<Item192[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item192[];
  return items.filter((i) => i.id > 192).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 194 (python)

A short calculation gives the result. Note that the series is absolutely convergent. Consider the general case. This follows from the lemma.

```python
import json
from dataclasses import dataclass

@dataclass
class Item193:
    id: int
    name: str

def load_193(path: str) -> list[Item193]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item193(**d) for d in data if d["id"] > 193]
```

## Example 195 (java)

The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```java
public final class Service194 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service194" + counts;
    }
}
```

## Example 196 (kotlin)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. This follows from the lemma.

```kotlin
data class Item195(val id: Int, val name: String)

fun process195(items: List<Item195>): Map<Int, String> =
    items.filter { it.id > 195 }
        .associate { it.id to it.name.uppercase() }
```

## Example 197 (rust)

A short calculation gives the result. The value converges quickly. This follows from the lemma. A short calculation gives the result.

```rust
use std::collections::HashMap;

pub fn count_196(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 198 (go)

This follows from the lemma. The value converges quickly. We now look at the bound. The value converges quickly. The value converges quickly.

```go
package main

import "fmt"

func sum197(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum197([]int{1, 2, 3})) }
```

## Example 199 (bash)

Note that the series is absolutely convergent. The value converges quickly. The value converges quickly.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (198)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 200 (json)

We now look at the bound. A short calculation gives the result. We now look at the bound. The value converges quickly.

```json
{
  "name": "pkg-199",
  "version": "1.0.199",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 201 (yaml)

This follows from the lemma. The value converges quickly. The value converges quickly. Note that the series is absolutely convergent.

```yaml
name: build-200
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 202 (sql)

This follows from the lemma. A short calculation gives the result. Note that the series is absolutely convergent. Note that the series is absolutely convergent. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 211;
```

## Example 203 (css)

The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```css
.card-202 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 202px;
}
.card-202:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 204 (html)

Consider the general case. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Consider the general case. The value converges quickly.

```html
<section class="hero-203">
  <h1>Title 203</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 205 (ts)

This follows from the lemma. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Consider the general case.

```ts
interface Item204 {
  id: number;
  name: string;
}

export async function load204(url: string): Promise<Item204[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item204[];
  return items.filter((i) => i.id > 204).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 206 (python)

Consider the general case. Consider the general case. A short calculation gives the result. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item205:
    id: int
    name: str

def load_205(path: str) -> list[Item205]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item205(**d) for d in data if d["id"] > 205]
```

## Example 207 (java)

This follows from the lemma. Consider the general case. This follows from the lemma. Consider the general case. The value converges quickly.

```java
public final class Service206 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service206" + counts;
    }
}
```

## Example 208 (kotlin)

The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case.

```kotlin
data class Item207(val id: Int, val name: String)

fun process207(items: List<Item207>): Map<Int, String> =
    items.filter { it.id > 207 }
        .associate { it.id to it.name.uppercase() }
```

## Example 209 (rust)

This follows from the lemma. Consider the general case. We now look at the bound. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_208(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 210 (go)

Consider the general case. Note that the series is absolutely convergent. We now look at the bound.

```go
package main

import "fmt"

func sum209(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum209([]int{1, 2, 3})) }
```

## Example 211 (bash)

Note that the series is absolutely convergent. We now look at the bound. The value converges quickly. This follows from the lemma. This follows from the lemma. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (210)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 212 (json)

Consider the general case. We now look at the bound. The value converges quickly. This follows from the lemma.

```json
{
  "name": "pkg-211",
  "version": "1.0.211",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 213 (yaml)

Consider the general case. We now look at the bound. This follows from the lemma. This follows from the lemma. Consider the general case.

```yaml
name: build-212
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 214 (sql)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. The value converges quickly. The value converges quickly. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 223;
```

## Example 215 (css)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. We now look at the bound.

```css
.card-214 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 214px;
}
.card-214:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 216 (html)

Consider the general case. We now look at the bound. Note that the series is absolutely convergent. Consider the general case. Consider the general case. This follows from the lemma.

```html
<section class="hero-215">
  <h1>Title 215</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 217 (ts)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```ts
interface Item216 {
  id: number;
  name: string;
}

export async function load216(url: string): Promise<Item216[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item216[];
  return items.filter((i) => i.id > 216).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 218 (python)

We now look at the bound. Note that the series is absolutely convergent. We now look at the bound. A short calculation gives the result. The value converges quickly. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item217:
    id: int
    name: str

def load_217(path: str) -> list[Item217]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item217(**d) for d in data if d["id"] > 217]
```

## Example 219 (java)

Consider the general case. The value converges quickly. We now look at the bound.

```java
public final class Service218 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service218" + counts;
    }
}
```

## Example 220 (kotlin)

We now look at the bound. This follows from the lemma. The value converges quickly. Consider the general case. Consider the general case. A short calculation gives the result.

```kotlin
data class Item219(val id: Int, val name: String)

fun process219(items: List<Item219>): Map<Int, String> =
    items.filter { it.id > 219 }
        .associate { it.id to it.name.uppercase() }
```

## Example 221 (rust)

The value converges quickly. Note that the series is absolutely convergent. Note that the series is absolutely convergent. This follows from the lemma. The value converges quickly. This follows from the lemma.

```rust
use std::collections::HashMap;

pub fn count_220(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 222 (go)

Note that the series is absolutely convergent. Consider the general case. Consider the general case. Consider the general case. The value converges quickly. We now look at the bound.

```go
package main

import "fmt"

func sum221(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum221([]int{1, 2, 3})) }
```

## Example 223 (bash)

The value converges quickly. We now look at the bound. The value converges quickly. The value converges quickly. This follows from the lemma.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (222)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 224 (json)

This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound.

```json
{
  "name": "pkg-223",
  "version": "1.0.223",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 225 (yaml)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```yaml
name: build-224
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 226 (sql)

We now look at the bound. Consider the general case. We now look at the bound. The value converges quickly. Note that the series is absolutely convergent.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 235;
```

## Example 227 (css)

Consider the general case. A short calculation gives the result. Consider the general case. Consider the general case. We now look at the bound. Consider the general case.

```css
.card-226 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 226px;
}
.card-226:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 228 (html)

A short calculation gives the result. A short calculation gives the result. Consider the general case. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```html
<section class="hero-227">
  <h1>Title 227</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 229 (ts)

We now look at the bound. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item228 {
  id: number;
  name: string;
}

export async function load228(url: string): Promise<Item228[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item228[];
  return items.filter((i) => i.id > 228).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 230 (python)

A short calculation gives the result. Consider the general case. A short calculation gives the result. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item229:
    id: int
    name: str

def load_229(path: str) -> list[Item229]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item229(**d) for d in data if d["id"] > 229]
```

## Example 231 (java)

A short calculation gives the result. Note that the series is absolutely convergent. The value converges quickly.

```java
public final class Service230 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service230" + counts;
    }
}
```

## Example 232 (kotlin)

A short calculation gives the result. The value converges quickly. This follows from the lemma.

```kotlin
data class Item231(val id: Int, val name: String)

fun process231(items: List<Item231>): Map<Int, String> =
    items.filter { it.id > 231 }
        .associate { it.id to it.name.uppercase() }
```

## Example 233 (rust)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_232(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 234 (go)

A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. We now look at the bound. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum233(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum233([]int{1, 2, 3})) }
```

## Example 235 (bash)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. The value converges quickly. Consider the general case.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (234)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 236 (json)

A short calculation gives the result. The value converges quickly. The value converges quickly. We now look at the bound. Consider the general case.

```json
{
  "name": "pkg-235",
  "version": "1.0.235",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 237 (yaml)

Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```yaml
name: build-236
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 238 (sql)

A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. A short calculation gives the result. A short calculation gives the result.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 247;
```

## Example 239 (css)

Consider the general case. We now look at the bound. We now look at the bound. Note that the series is absolutely convergent. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```css
.card-238 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 238px;
}
.card-238:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 240 (html)

Consider the general case. The value converges quickly. This follows from the lemma. Consider the general case. The value converges quickly.

```html
<section class="hero-239">
  <h1>Title 239</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 241 (ts)

This follows from the lemma. We now look at the bound. Note that the series is absolutely convergent.

```ts
interface Item240 {
  id: number;
  name: string;
}

export async function load240(url: string): Promise<Item240[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item240[];
  return items.filter((i) => i.id > 240).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 242 (python)

Consider the general case. Consider the general case. This follows from the lemma. This follows from the lemma. The value converges quickly. Note that the series is absolutely convergent.

```python
import json
from dataclasses import dataclass

@dataclass
class Item241:
    id: int
    name: str

def load_241(path: str) -> list[Item241]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item241(**d) for d in data if d["id"] > 241]
```

## Example 243 (java)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. The value converges quickly. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```java
public final class Service242 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service242" + counts;
    }
}
```

## Example 244 (kotlin)

This follows from the lemma. Note that the series is absolutely convergent. Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```kotlin
data class Item243(val id: Int, val name: String)

fun process243(items: List<Item243>): Map<Int, String> =
    items.filter { it.id > 243 }
        .associate { it.id to it.name.uppercase() }
```

## Example 245 (rust)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_244(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 246 (go)

This follows from the lemma. We now look at the bound. We now look at the bound. We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```go
package main

import "fmt"

func sum245(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum245([]int{1, 2, 3})) }
```

## Example 247 (bash)

The value converges quickly. Consider the general case. The value converges quickly.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (246)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 248 (json)

This follows from the lemma. Consider the general case. We now look at the bound. The value converges quickly.

```json
{
  "name": "pkg-247",
  "version": "1.0.247",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 249 (yaml)

The value converges quickly. The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```yaml
name: build-248
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 250 (sql)

Note that the series is absolutely convergent. A short calculation gives the result. The value converges quickly.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 259;
```

## Example 251 (css)

Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. A short calculation gives the result. The value converges quickly.

```css
.card-250 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 250px;
}
.card-250:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 252 (html)

Consider the general case. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. A short calculation gives the result. A short calculation gives the result.

```html
<section class="hero-251">
  <h1>Title 251</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 253 (ts)

This follows from the lemma. Note that the series is absolutely convergent. A short calculation gives the result.

```ts
interface Item252 {
  id: number;
  name: string;
}

export async function load252(url: string): Promise<Item252[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item252[];
  return items.filter((i) => i.id > 252).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 254 (python)

The value converges quickly. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. This follows from the lemma. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item253:
    id: int
    name: str

def load_253(path: str) -> list[Item253]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item253(**d) for d in data if d["id"] > 253]
```

## Example 255 (java)

We now look at the bound. Note that the series is absolutely convergent. We now look at the bound.

```java
public final class Service254 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service254" + counts;
    }
}
```

## Example 256 (kotlin)

The value converges quickly. We now look at the bound. The value converges quickly. Consider the general case. A short calculation gives the result.

```kotlin
data class Item255(val id: Int, val name: String)

fun process255(items: List<Item255>): Map<Int, String> =
    items.filter { it.id > 255 }
        .associate { it.id to it.name.uppercase() }
```

## Example 257 (rust)

Consider the general case. Consider the general case. A short calculation gives the result.

```rust
use std::collections::HashMap;

pub fn count_256(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 258 (go)

Consider the general case. Note that the series is absolutely convergent. The value converges quickly. A short calculation gives the result.

```go
package main

import "fmt"

func sum257(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum257([]int{1, 2, 3})) }
```

## Example 259 (bash)

This follows from the lemma. Note that the series is absolutely convergent. We now look at the bound. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (258)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 260 (json)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound.

```json
{
  "name": "pkg-259",
  "version": "1.0.259",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 261 (yaml)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. The value converges quickly. We now look at the bound. We now look at the bound.

```yaml
name: build-260
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 262 (sql)

Note that the series is absolutely convergent. We now look at the bound. Consider the general case. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 271;
```

## Example 263 (css)

This follows from the lemma. Note that the series is absolutely convergent. A short calculation gives the result. We now look at the bound. A short calculation gives the result. Consider the general case.

```css
.card-262 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 262px;
}
.card-262:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 264 (html)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Consider the general case.

```html
<section class="hero-263">
  <h1>Title 263</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 265 (ts)

With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. This follows from the lemma. We now look at the bound. Note that the series is absolutely convergent. A short calculation gives the result.

```ts
interface Item264 {
  id: number;
  name: string;
}

export async function load264(url: string): Promise<Item264[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item264[];
  return items.filter((i) => i.id > 264).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 266 (python)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. This follows from the lemma.

```python
import json
from dataclasses import dataclass

@dataclass
class Item265:
    id: int
    name: str

def load_265(path: str) -> list[Item265]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item265(**d) for d in data if d["id"] > 265]
```

## Example 267 (java)

The value converges quickly. Consider the general case. The value converges quickly. Note that the series is absolutely convergent. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```java
public final class Service266 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service266" + counts;
    }
}
```

## Example 268 (kotlin)

Consider the general case. Consider the general case. We now look at the bound. This follows from the lemma.

```kotlin
data class Item267(val id: Int, val name: String)

fun process267(items: List<Item267>): Map<Int, String> =
    items.filter { it.id > 267 }
        .associate { it.id to it.name.uppercase() }
```

## Example 269 (rust)

We now look at the bound. Consider the general case. The value converges quickly.

```rust
use std::collections::HashMap;

pub fn count_268(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 270 (go)

A short calculation gives the result. This follows from the lemma. A short calculation gives the result. Consider the general case. Consider the general case.

```go
package main

import "fmt"

func sum269(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum269([]int{1, 2, 3})) }
```

## Example 271 (bash)

We now look at the bound. This follows from the lemma. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent. This follows from the lemma.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (270)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 272 (json)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. The value converges quickly. We now look at the bound.

```json
{
  "name": "pkg-271",
  "version": "1.0.271",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 273 (yaml)

We now look at the bound. We now look at the bound. The value converges quickly.

```yaml
name: build-272
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 274 (sql)

Consider the general case. Note that the series is absolutely convergent. We now look at the bound. Consider the general case. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 283;
```

## Example 275 (css)

We now look at the bound. A short calculation gives the result. A short calculation gives the result. We now look at the bound.

```css
.card-274 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 274px;
}
.card-274:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 276 (html)

A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```html
<section class="hero-275">
  <h1>Title 275</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 277 (ts)

A short calculation gives the result. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. The value converges quickly. A short calculation gives the result.

```ts
interface Item276 {
  id: number;
  name: string;
}

export async function load276(url: string): Promise<Item276[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item276[];
  return items.filter((i) => i.id > 276).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 278 (python)

Consider the general case. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item277:
    id: int
    name: str

def load_277(path: str) -> list[Item277]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item277(**d) for d in data if d["id"] > 277]
```

## Example 279 (java)

A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```java
public final class Service278 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service278" + counts;
    }
}
```

## Example 280 (kotlin)

Note that the series is absolutely convergent. A short calculation gives the result. Note that the series is absolutely convergent.

```kotlin
data class Item279(val id: Int, val name: String)

fun process279(items: List<Item279>): Map<Int, String> =
    items.filter { it.id > 279 }
        .associate { it.id to it.name.uppercase() }
```

## Example 281 (rust)

Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent. A short calculation gives the result. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_280(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 282 (go)

Consider the general case. Consider the general case. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```go
package main

import "fmt"

func sum281(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum281([]int{1, 2, 3})) }
```

## Example 283 (bash)

A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. This follows from the lemma.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (282)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 284 (json)

Consider the general case. This follows from the lemma. A short calculation gives the result. We now look at the bound.

```json
{
  "name": "pkg-283",
  "version": "1.0.283",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 285 (yaml)

This follows from the lemma. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma.

```yaml
name: build-284
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 286 (sql)

Note that the series is absolutely convergent. The value converges quickly. Consider the general case. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 295;
```

## Example 287 (css)

The value converges quickly. Note that the series is absolutely convergent. This follows from the lemma.

```css
.card-286 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 286px;
}
.card-286:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 288 (html)

A short calculation gives the result. A short calculation gives the result. Note that the series is absolutely convergent. This follows from the lemma.

```html
<section class="hero-287">
  <h1>Title 287</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 289 (ts)

This follows from the lemma. This follows from the lemma. Note that the series is absolutely convergent. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item288 {
  id: number;
  name: string;
}

export async function load288(url: string): Promise<Item288[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item288[];
  return items.filter((i) => i.id > 288).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 290 (python)

The value converges quickly. This follows from the lemma. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item289:
    id: int
    name: str

def load_289(path: str) -> list[Item289]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item289(**d) for d in data if d["id"] > 289]
```

## Example 291 (java)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```java
public final class Service290 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service290" + counts;
    }
}
```

## Example 292 (kotlin)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```kotlin
data class Item291(val id: Int, val name: String)

fun process291(items: List<Item291>): Map<Int, String> =
    items.filter { it.id > 291 }
        .associate { it.id to it.name.uppercase() }
```

## Example 293 (rust)

A short calculation gives the result. We now look at the bound. The value converges quickly. Consider the general case. The value converges quickly. Note that the series is absolutely convergent.

```rust
use std::collections::HashMap;

pub fn count_292(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 294 (go)

We now look at the bound. This follows from the lemma. Note that the series is absolutely convergent.

```go
package main

import "fmt"

func sum293(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum293([]int{1, 2, 3})) }
```

## Example 295 (bash)

Consider the general case. This follows from the lemma. The value converges quickly. This follows from the lemma.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (294)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 296 (json)

The value converges quickly. We now look at the bound. The value converges quickly. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-295",
  "version": "1.0.295",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 297 (yaml)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```yaml
name: build-296
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 298 (sql)

This follows from the lemma. Consider the general case. Note that the series is absolutely convergent.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 307;
```

## Example 299 (css)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```css
.card-298 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 298px;
}
.card-298:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 300 (html)

We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```html
<section class="hero-299">
  <h1>Title 299</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 301 (ts)

The value converges quickly. Note that the series is absolutely convergent. Note that the series is absolutely convergent. Consider the general case. Consider the general case. The value converges quickly.

```ts
interface Item300 {
  id: number;
  name: string;
}

export async function load300(url: string): Promise<Item300[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item300[];
  return items.filter((i) => i.id > 300).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 302 (python)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. We now look at the bound. The value converges quickly. We now look at the bound. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item301:
    id: int
    name: str

def load_301(path: str) -> list[Item301]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item301(**d) for d in data if d["id"] > 301]
```

## Example 303 (java)

We now look at the bound. We now look at the bound. A short calculation gives the result. The value converges quickly.

```java
public final class Service302 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service302" + counts;
    }
}
```

## Example 304 (kotlin)

We now look at the bound. This follows from the lemma. The value converges quickly. This follows from the lemma. This follows from the lemma.

```kotlin
data class Item303(val id: Int, val name: String)

fun process303(items: List<Item303>): Map<Int, String> =
    items.filter { it.id > 303 }
        .associate { it.id to it.name.uppercase() }
```

## Example 305 (rust)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. The value converges quickly. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_304(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 306 (go)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. Consider the general case. The value converges quickly. This follows from the lemma.

```go
package main

import "fmt"

func sum305(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum305([]int{1, 2, 3})) }
```

## Example 307 (bash)

A short calculation gives the result. The value converges quickly. We now look at the bound. This follows from the lemma. A short calculation gives the result.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (306)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 308 (json)

Consider the general case. This follows from the lemma. Consider the general case. This follows from the lemma. Note that the series is absolutely convergent. The value converges quickly.

```json
{
  "name": "pkg-307",
  "version": "1.0.307",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 309 (yaml)

A short calculation gives the result. We now look at the bound. Note that the series is absolutely convergent. The value converges quickly.

```yaml
name: build-308
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 310 (sql)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 319;
```

## Example 311 (css)

Consider the general case. We now look at the bound. Note that the series is absolutely convergent.

```css
.card-310 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 310px;
}
.card-310:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 312 (html)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. This follows from the lemma.

```html
<section class="hero-311">
  <h1>Title 311</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 313 (ts)

We now look at the bound. Consider the general case. The value converges quickly. This follows from the lemma. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item312 {
  id: number;
  name: string;
}

export async function load312(url: string): Promise<Item312[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item312[];
  return items.filter((i) => i.id > 312).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 314 (python)

The value converges quickly. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item313:
    id: int
    name: str

def load_313(path: str) -> list[Item313]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item313(**d) for d in data if d["id"] > 313]
```

## Example 315 (java)

Consider the general case. A short calculation gives the result. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```java
public final class Service314 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service314" + counts;
    }
}
```

## Example 316 (kotlin)

This follows from the lemma. A short calculation gives the result. Note that the series is absolutely convergent. A short calculation gives the result. We now look at the bound.

```kotlin
data class Item315(val id: Int, val name: String)

fun process315(items: List<Item315>): Map<Int, String> =
    items.filter { it.id > 315 }
        .associate { it.id to it.name.uppercase() }
```

## Example 317 (rust)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. We now look at the bound.

```rust
use std::collections::HashMap;

pub fn count_316(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 318 (go)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Consider the general case. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```go
package main

import "fmt"

func sum317(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum317([]int{1, 2, 3})) }
```

## Example 319 (bash)

We now look at the bound. Consider the general case. Consider the general case. We now look at the bound.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (318)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 320 (json)

Consider the general case. Consider the general case. Consider the general case. The value converges quickly.

```json
{
  "name": "pkg-319",
  "version": "1.0.319",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 321 (yaml)

We now look at the bound. We now look at the bound. Consider the general case. Note that the series is absolutely convergent. Consider the general case. Note that the series is absolutely convergent.

```yaml
name: build-320
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 322 (sql)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. The value converges quickly. We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 331;
```

## Example 323 (css)

We now look at the bound. A short calculation gives the result. We now look at the bound. A short calculation gives the result.

```css
.card-322 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 322px;
}
.card-322:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 324 (html)

Note that the series is absolutely convergent. A short calculation gives the result. This follows from the lemma. Consider the general case.

```html
<section class="hero-323">
  <h1>Title 323</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 325 (ts)

The value converges quickly. We now look at the bound. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item324 {
  id: number;
  name: string;
}

export async function load324(url: string): Promise<Item324[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item324[];
  return items.filter((i) => i.id > 324).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 326 (python)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item325:
    id: int
    name: str

def load_325(path: str) -> list[Item325]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item325(**d) for d in data if d["id"] > 325]
```

## Example 327 (java)

We now look at the bound. We now look at the bound. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`.

```java
public final class Service326 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service326" + counts;
    }
}
```

## Example 328 (kotlin)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. We now look at the bound.

```kotlin
data class Item327(val id: Int, val name: String)

fun process327(items: List<Item327>): Map<Int, String> =
    items.filter { it.id > 327 }
        .associate { it.id to it.name.uppercase() }
```

## Example 329 (rust)

The value converges quickly. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```rust
use std::collections::HashMap;

pub fn count_328(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 330 (go)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case.

```go
package main

import "fmt"

func sum329(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum329([]int{1, 2, 3})) }
```

## Example 331 (bash)

Note that the series is absolutely convergent. The value converges quickly. Consider the general case. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (330)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 332 (json)

A short calculation gives the result. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-331",
  "version": "1.0.331",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 333 (yaml)

Note that the series is absolutely convergent. This follows from the lemma. We now look at the bound. Note that the series is absolutely convergent. Note that the series is absolutely convergent. This follows from the lemma.

```yaml
name: build-332
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 334 (sql)

We now look at the bound. This follows from the lemma. Consider the general case. We now look at the bound. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 343;
```

## Example 335 (css)

A short calculation gives the result. Note that the series is absolutely convergent. The value converges quickly.

```css
.card-334 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 334px;
}
.card-334:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 336 (html)

The value converges quickly. We now look at the bound. We now look at the bound. This follows from the lemma. This follows from the lemma.

```html
<section class="hero-335">
  <h1>Title 335</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 337 (ts)

Consider the general case. We now look at the bound. We now look at the bound. We now look at the bound.

```ts
interface Item336 {
  id: number;
  name: string;
}

export async function load336(url: string): Promise<Item336[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item336[];
  return items.filter((i) => i.id > 336).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 338 (python)

This follows from the lemma. We now look at the bound. The value converges quickly. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item337:
    id: int
    name: str

def load_337(path: str) -> list[Item337]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item337(**d) for d in data if d["id"] > 337]
```

## Example 339 (java)

This follows from the lemma. Consider the general case. This follows from the lemma. A short calculation gives the result. We now look at the bound.

```java
public final class Service338 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service338" + counts;
    }
}
```

## Example 340 (kotlin)

The value converges quickly. We now look at the bound. Consider the general case. The value converges quickly. A short calculation gives the result. This follows from the lemma.

```kotlin
data class Item339(val id: Int, val name: String)

fun process339(items: List<Item339>): Map<Int, String> =
    items.filter { it.id > 339 }
        .associate { it.id to it.name.uppercase() }
```

## Example 341 (rust)

With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result. A short calculation gives the result.

```rust
use std::collections::HashMap;

pub fn count_340(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 342 (go)

Consider the general case. Consider the general case. Note that the series is absolutely convergent. Note that the series is absolutely convergent. Consider the general case.

```go
package main

import "fmt"

func sum341(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum341([]int{1, 2, 3})) }
```

## Example 343 (bash)

A short calculation gives the result. The value converges quickly. A short calculation gives the result.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (342)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 344 (json)

The value converges quickly. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-343",
  "version": "1.0.343",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 345 (yaml)

Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Consider the general case. A short calculation gives the result.

```yaml
name: build-344
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 346 (sql)

Consider the general case. Note that the series is absolutely convergent. This follows from the lemma. Consider the general case. The value converges quickly. The value converges quickly.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 355;
```

## Example 347 (css)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Consider the general case. A short calculation gives the result.

```css
.card-346 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 346px;
}
.card-346:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 348 (html)

This follows from the lemma. We now look at the bound. This follows from the lemma.

```html
<section class="hero-347">
  <h1>Title 347</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 349 (ts)

With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Consider the general case. Consider the general case. This follows from the lemma. This follows from the lemma.

```ts
interface Item348 {
  id: number;
  name: string;
}

export async function load348(url: string): Promise<Item348[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item348[];
  return items.filter((i) => i.id > 348).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 350 (python)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Consider the general case. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item349:
    id: int
    name: str

def load_349(path: str) -> list[Item349]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item349(**d) for d in data if d["id"] > 349]
```

## Example 351 (java)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. A short calculation gives the result. This follows from the lemma.

```java
public final class Service350 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service350" + counts;
    }
}
```

## Example 352 (kotlin)

Consider the general case. A short calculation gives the result. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```kotlin
data class Item351(val id: Int, val name: String)

fun process351(items: List<Item351>): Map<Int, String> =
    items.filter { it.id > 351 }
        .associate { it.id to it.name.uppercase() }
```

## Example 353 (rust)

Consider the general case. Consider the general case. Note that the series is absolutely convergent. A short calculation gives the result.

```rust
use std::collections::HashMap;

pub fn count_352(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 354 (go)

This follows from the lemma. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. The value converges quickly. A short calculation gives the result.

```go
package main

import "fmt"

func sum353(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum353([]int{1, 2, 3})) }
```

## Example 355 (bash)

Consider the general case. The value converges quickly. Note that the series is absolutely convergent. This follows from the lemma. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (354)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 356 (json)

Note that the series is absolutely convergent. A short calculation gives the result. The value converges quickly. The value converges quickly. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-355",
  "version": "1.0.355",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 357 (yaml)

With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Consider the general case. A short calculation gives the result.

```yaml
name: build-356
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 358 (sql)

Note that the series is absolutely convergent. We now look at the bound. Consider the general case. We now look at the bound.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 367;
```

## Example 359 (css)

A short calculation gives the result. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent. The value converges quickly.

```css
.card-358 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 358px;
}
.card-358:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 360 (html)

This follows from the lemma. A short calculation gives the result. This follows from the lemma.

```html
<section class="hero-359">
  <h1>Title 359</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 361 (ts)

With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`.

```ts
interface Item360 {
  id: number;
  name: string;
}

export async function load360(url: string): Promise<Item360[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item360[];
  return items.filter((i) => i.id > 360).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 362 (python)

Consider the general case. The value converges quickly. Note that the series is absolutely convergent. A short calculation gives the result.

```python
import json
from dataclasses import dataclass

@dataclass
class Item361:
    id: int
    name: str

def load_361(path: str) -> list[Item361]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item361(**d) for d in data if d["id"] > 361]
```

## Example 363 (java)

A short calculation gives the result. Consider the general case. This follows from the lemma. Note that the series is absolutely convergent. A short calculation gives the result. We now look at the bound.

```java
public final class Service362 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service362" + counts;
    }
}
```

## Example 364 (kotlin)

A short calculation gives the result. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. Consider the general case.

```kotlin
data class Item363(val id: Int, val name: String)

fun process363(items: List<Item363>): Map<Int, String> =
    items.filter { it.id > 363 }
        .associate { it.id to it.name.uppercase() }
```

## Example 365 (rust)

Note that the series is absolutely convergent. The value converges quickly. Consider the general case.

```rust
use std::collections::HashMap;

pub fn count_364(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 366 (go)

Consider the general case. We now look at the bound. Consider the general case. A short calculation gives the result. Note that the series is absolutely convergent. Consider the general case.

```go
package main

import "fmt"

func sum365(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum365([]int{1, 2, 3})) }
```

## Example 367 (bash)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. A short calculation gives the result. The value converges quickly. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (366)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 368 (json)

We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. We now look at the bound.

```json
{
  "name": "pkg-367",
  "version": "1.0.367",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 369 (yaml)

A short calculation gives the result. Note that the series is absolutely convergent. This follows from the lemma. The value converges quickly. Consider the general case. We now look at the bound.

```yaml
name: build-368
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 370 (sql)

A short calculation gives the result. We now look at the bound. A short calculation gives the result. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-01'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 379;
```

## Example 371 (css)

The value converges quickly. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma.

```css
.card-370 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 370px;
}
.card-370:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 372 (html)

Consider the general case. This follows from the lemma. Note that the series is absolutely convergent. Note that the series is absolutely convergent. A short calculation gives the result.

```html
<section class="hero-371">
  <h1>Title 371</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 373 (ts)

The value converges quickly. Note that the series is absolutely convergent. The value converges quickly. We now look at the bound.

```ts
interface Item372 {
  id: number;
  name: string;
}

export async function load372(url: string): Promise<Item372[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item372[];
  return items.filter((i) => i.id > 372).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 374 (python)

The value converges quickly. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`.

```python
import json
from dataclasses import dataclass

@dataclass
class Item373:
    id: int
    name: str

def load_373(path: str) -> list[Item373]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item373(**d) for d in data if d["id"] > 373]
```

## Example 375 (java)

This follows from the lemma. A short calculation gives the result. We now look at the bound.

```java
public final class Service374 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service374" + counts;
    }
}
```

## Example 376 (kotlin)

With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```kotlin
data class Item375(val id: Int, val name: String)

fun process375(items: List<Item375>): Map<Int, String> =
    items.filter { it.id > 375 }
        .associate { it.id to it.name.uppercase() }
```

## Example 377 (rust)

Note that the series is absolutely convergent. Note that the series is absolutely convergent. This follows from the lemma. Note that the series is absolutely convergent. A short calculation gives the result. Consider the general case.

```rust
use std::collections::HashMap;

pub fn count_376(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 378 (go)

This follows from the lemma. Consider the general case. This follows from the lemma. A short calculation gives the result. The value converges quickly. This follows from the lemma.

```go
package main

import "fmt"

func sum377(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum377([]int{1, 2, 3})) }
```

## Example 379 (bash)

The value converges quickly. We now look at the bound. We now look at the bound. Note that the series is absolutely convergent.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (378)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 380 (json)

Note that the series is absolutely convergent. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`.

```json
{
  "name": "pkg-379",
  "version": "1.0.379",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 381 (yaml)

The value converges quickly. Note that the series is absolutely convergent. Note that the series is absolutely convergent. We now look at the bound. We now look at the bound.

```yaml
name: build-380
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 382 (sql)

Consider the general case. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-04'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 391;
```

## Example 383 (css)

A short calculation gives the result. Note that the series is absolutely convergent. A short calculation gives the result. A short calculation gives the result. A short calculation gives the result.

```css
.card-382 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 382px;
}
.card-382:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 384 (html)

Consider the general case. Consider the general case. A short calculation gives the result. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. A short calculation gives the result.

```html
<section class="hero-383">
  <h1>Title 383</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 385 (ts)

This follows from the lemma. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. A short calculation gives the result.

```ts
interface Item384 {
  id: number;
  name: string;
}

export async function load384(url: string): Promise<Item384[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item384[];
  return items.filter((i) => i.id > 384).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 386 (python)

With **strong** and *emphasis* text and `code $x$ here`. Consider the general case. Consider the general case.

```python
import json
from dataclasses import dataclass

@dataclass
class Item385:
    id: int
    name: str

def load_385(path: str) -> list[Item385]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item385(**d) for d in data if d["id"] > 385]
```

## Example 387 (java)

Note that the series is absolutely convergent. We now look at the bound. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. Note that the series is absolutely convergent.

```java
public final class Service386 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service386" + counts;
    }
}
```

## Example 388 (kotlin)

Note that the series is absolutely convergent. A short calculation gives the result. The value converges quickly. A short calculation gives the result. Consider the general case. Note that the series is absolutely convergent.

```kotlin
data class Item387(val id: Int, val name: String)

fun process387(items: List<Item387>): Map<Int, String> =
    items.filter { it.id > 387 }
        .associate { it.id to it.name.uppercase() }
```

## Example 389 (rust)

With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. With **strong** and *emphasis* text and `code $x$ here`.

```rust
use std::collections::HashMap;

pub fn count_388(words: &[&str]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in words {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}
```

## Example 390 (go)

The value converges quickly. Consider the general case. Consider the general case.

```go
package main

import "fmt"

func sum389(xs []int) int {
	total := 0
	for _, x := range xs {
		total += x
	}
	return total
}

func main() { fmt.Println(sum389([]int{1, 2, 3})) }
```

## Example 391 (bash)

The value converges quickly. Note that the series is absolutely convergent. We now look at the bound. Consider the general case.

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "file $f (390)"
  wc -l "$f" | awk '{print $1}'
done
```

## Example 392 (json)

Consider the general case. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent.

```json
{
  "name": "pkg-391",
  "version": "1.0.391",
  "dependencies": { "a": "1.2.3", "b": "4.5.6" },
  "private": true
}
```

## Example 393 (yaml)

A short calculation gives the result. This follows from the lemma. Consider the general case. Note that the series is absolutely convergent.

```yaml
name: build-392
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

## Example 394 (sql)

With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. This follows from the lemma.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at > '2026-01-07'
GROUP BY c.name
ORDER BY orders DESC
LIMIT 403;
```

## Example 395 (css)

With **strong** and *emphasis* text and `code $x$ here`. The value converges quickly. We now look at the bound. The value converges quickly. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```css
.card-394 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  color: #333;
  padding: 394px;
}
.card-394:hover { background: rgba(0, 0, 0, 0.05); }
```

## Example 396 (html)

Note that the series is absolutely convergent. With **strong** and *emphasis* text and `code $x$ here`. This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`.

```html
<section class="hero-395">
  <h1>Title 395</h1>
  <p>Some <b>bold</b> text.</p>
  <button type="button" disabled>Go</button>
</section>
```

## Example 397 (ts)

A short calculation gives the result. Note that the series is absolutely convergent. A short calculation gives the result.

```ts
interface Item396 {
  id: number;
  name: string;
}

export async function load396(url: string): Promise<Item396[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as Item396[];
  return items.filter((i) => i.id > 396).map((i) => ({ ...i, name: i.name.trim() }));
}
```

## Example 398 (python)

This follows from the lemma. We now look at the bound. A short calculation gives the result. A short calculation gives the result. The value converges quickly.

```python
import json
from dataclasses import dataclass

@dataclass
class Item397:
    id: int
    name: str

def load_397(path: str) -> list[Item397]:
    with open(path) as f:
        data = json.load(f)
    # keep the large ids
    return [Item397(**d) for d in data if d["id"] > 397]
```

## Example 399 (java)

This follows from the lemma. Consider the general case. Note that the series is absolutely convergent.

```java
public final class Service398 {
    private final Map<String, Integer> counts = new HashMap<>();

    public int add(String key) {
        return counts.merge(key, 1, Integer::sum);
    }

    @Override
    public String toString() {
        return "Service398" + counts;
    }
}
```

## Example 400 (kotlin)

This follows from the lemma. With **strong** and *emphasis* text and `code $x$ here`. Note that the series is absolutely convergent.

```kotlin
data class Item399(val id: Int, val name: String)

fun process399(items: List<Item399>): Map<Int, String> =
    items.filter { it.id > 399 }
        .associate { it.id to it.name.uppercase() }
```
