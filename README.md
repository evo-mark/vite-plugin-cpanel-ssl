<p align="center">
    <a href="https://evomark.co.uk" target="_blank" alt="Link to evoMark's website">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://evomark.co.uk/wp-content/uploads/static/evomark-logo--dark.svg">
          <source media="(prefers-color-scheme: light)" srcset="https://evomark.co.uk/wp-content/uploads/static/evomark-logo--light.svg">
          <img alt="evoMark company logo" src="https://evomark.co.uk/wp-content/uploads/static/evomark-logo--light.svg" width="500">
        </picture>
    </a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/dm/@evomark/vite-plugin-cpanel-ssl.svg" alt="Downloads"></a>
  <a href="https://www.npmjs.com/package/@evomark/vite-plugin-cpanel-ssl"><img src="https://img.shields.io/npm/v/@evomark/vite-plugin-cpanel-ssl.svg" alt="Version"></a>
  <a href="https://github.com/evo-mark/vite-plugin-cpanel-ssl/blob/main/LICENCE"><img src="https://img.shields.io/github/license/evo-mark/vite-plugin-cpanel-ssl?style=flat" alt="Licence"></a>
</p>

# Vite Plugin cPanel SSL

Simple, zero-dependency plugin for Vite that is designed for dev servers running in a WHM/cPanel environment.

Your cPanel-issued SSL certificate and key will automatically be used, allowing your to access your Vite dev server over your standard https domain.

---

## Installation

```sh
pnpm add -D @evomark/vite-plugin-cpanel-ssl
```

## Basic Usage

> [!TIP]
> Remember that you'll need to pass a domain name in your `server.https.host` option that matches the domain on your SSL certificates

Simply import the plugin and add it to your Vite config plugins array:

```js
import cPanelSSL from "vite-plugin-cpanel-ssl";

export default {
	plugins: [
		cPanelSSL({
			domain: "my-domain.com",
		}),
	],
};
```

You can optionally pass a config object too:

```js
plugins: [
    cPanelSSL({
        enable: env.SOME_CONDITION,
        domain: "override-ssl-domain.com"
    })
],
```
