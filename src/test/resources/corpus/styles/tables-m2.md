# Table edge cases (M2)

| Name | Value | Notes |
|:-----|------:|:-----:|
| escaped \| pipe | `a\|b` | **bold** and *em* |
| [link](https://example.com) | ~~old~~ 2 | |
| missing cell | 3 |
| extra | 4 | x | dropped |

Plain | No | Outer
--- | --- | ---
1 | 2 | 3

> | Quoted | Table |
> |-------:|:------|
> | right  | left  |

- List item with a table:

  | In | List |
  |----|------|
  | a  | b    |

|||
|-|-|
|empty|header|

Not a table: | a | `b|c` |
|---|---|
