# Math edge cases (M4)

Prices like $5 and $10 stay text, and so does $ 5 to 6 $.
An escaped \$x$ is text; $a\$b$ is one formula; `$x$` in code is code.
Inline $x^2$, display inline $$\sum_{k=1}^n k$$, and $a$1 and $b$ (closer before a digit).
Emphasis around math: *a $y$ b* and **$z$**.

Text before a block
$$
\frac{a}{b}
$$
text after the block.

$$ e^{i\pi} + 1 = 0 $$

$$
a + b

# not a heading inside a math block

- not a list item
$$

- item with math $x$
- item with a block:
  $$
  \int_0^1 x\,dx
  $$

> quote with $q$
> $$
> \sqrt{2}
> $$

| a | b |
|---|---|
| $x$ | $y$ |

    $$ indented four: code $$

```
$$ in a fence is code
```

A formula over
two lines $a +
b$ in one paragraph.

$$
unclosed block at the end
runs to the end of the document

## not a heading either
