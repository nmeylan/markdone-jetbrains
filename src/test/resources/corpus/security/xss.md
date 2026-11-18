# XSS probe

<script>window.__xss = 'script';</script>

<img src=x onerror="window.__xss = 'img'">

Inline <img src=x onerror="window.__xss = 'inline-img'"> html.

[js link](javascript:window.__xss='link')

<iframe src="https://example.com"></iframe>
