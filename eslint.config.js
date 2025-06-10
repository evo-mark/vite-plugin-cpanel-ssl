import configPrettier from "eslint-config-prettier";
import globals from "globals";
import js from "@eslint/js";

export default [
	js.configs.recommended,
	configPrettier,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
];
