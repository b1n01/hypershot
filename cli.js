#!/usr/bin/env node

const fs = require('fs')
const hypershot = require('./index.js');

const url = process.argv[2];
if (!url) { 
	console.log('Missing "url" parameter');
	return;
}

const path = process.argv[3];
if (!path) { 
	console.log('Missing "path" parameter');
	return;
}

(async () => {
	console.log('[hypershot] Fetching', url);

	if (!fs.existsSync(path)) fs.mkdirSync(path);
	const folder = await hypershot(url, path);

	console.log('[hypershot] Anspshot ready at', folder);
})();