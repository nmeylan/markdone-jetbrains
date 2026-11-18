# Fence inside a list

- item one

  ```js
  code in item

not code: the list and the fence end here
  ```

Paragraph after.

- item two
  ```
  unclosed fence in an item

Top level again (closes the item and its fence).

```
top-level fence

# not a heading
- not a list

```

> ```
> fence in a quote
>
> still in the quote fence
after the quote (lazy? no: closes)

1. ordered
   ~~~~
   tilde fence in item

   ~~~
   still in the tilde fence (shorter closer)

   ~~~~

Done.

   ```
indented top-level fence (3 spaces)

text inside

   ```

    ```
    indented code, not a fence

Outside.
