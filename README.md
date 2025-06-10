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
  <img src="https://img.shields.io/npm/dm/vite-plugin-cpanel-ssl.svg" alt="Downloads"></a>
  <a href="https://www.npmjs.com/package/vite-plugin-cpanel-ssl"><img src="https://img.shields.io/npm/v/vite-plugin-cpanel-ssl.svg" alt="Version"></a>
  <a href="https://github.com/evo-mark/vite-plugin-cpanel-ssl/blob/main/LICENCE"><img src="https://img.shields.io/github/license/evo-mark/vite-plugin-cpanel-ssl?style=flat" alt="Licence"></a>
</p>

# Vite Plugin cPanel SSL

Simple, zero-dependency plugin for Vite that is designed for dev servers running in a WHM/cPanel environment.

Your cPanel-issued SSL certificate and key will automatically be used, allowing your to access your Vite dev server over your standard https domain.

---

## Installation

```sh
pnpm add -D vite-plugin-cpanel-ssl
```

## Basic Usage

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

## Support Open-Source Software

We're providing this community adapter free-of-charge without any paywalled features. However, all development and maintenance costs time, energy and money. So please help fund this project if you can.

<p align="center" style="display:flex;align-items:center;gap:1rem;justify-content:center">
<a href="https://github.com/sponsors/craigrileyuk" target="_blank"><img src="https://img.shields.io/badge/sponsor-GitHub%20Sponsors-fafbfc?style=for-the-badge&logo=github" /></a>
<a href="https://www.buymeacoffee.com/craigrileyuk" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" /></a>
</p>
