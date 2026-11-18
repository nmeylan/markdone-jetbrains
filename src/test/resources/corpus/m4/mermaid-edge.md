# Mermaid edge cases (M4)

A valid diagram:

```mermaid
flowchart LR
  A[Start] --> B[End]
```

An invalid diagram shows the error text:

```mermaid
flowchart LR
  A --> --> B ((
```

An empty diagram:

```mermaid
```

Mermaid inside a list item:

- item
  ```mermaid
  pie title Pets
    "Dogs" : 3
    "Cats" : 2
  ```

Text after.
