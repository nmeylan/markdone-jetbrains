# Table edge cases (shared fixture)

Lazy body row without pipes:

| Key | Value |
|-----|-------|
| a   | 1     |
lazy row
| b   | 2     |

- | a | b |
  |---|---|
  | 1 | 2 |

1. | a |
   |:-:|
   | x |

> Quote with a table:
>
> | Left | Right |
> |:-----|------:|
> | l    | r     |
> lazy in quote

- List item with a table:

  | In | List | `code \| pipe` |
  |----|:----:|----------------|
  | a  | b    | c \| d         |
  | e  |
