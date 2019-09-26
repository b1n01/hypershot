const puppeteer = require('puppeteer');
const fs = require('fs')
const fsPromises = require('fs').promises;
const mimes = require('mime-db');
const axios = require('axios');

const url = process.argv[2];
if(!url) { console.log('Missing url parameter'); return; }

const storageFolder = './storage/';
const tempFolder = './.tmp/';
if(!fs.existsSync(storageFolder)) fs.mkdirSync(storageFolder);
if(!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

console.log('Archiving ' + url);

const origin = (new URL(url)).origin;
const host = (new URL(url)).host;

(async () => {
	console.log('Loading page');
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.goto(url);
	
	console.log(mimes);

	// Bind puppeteer console to node console
	page.on('console', obj => console.log(obj.text()));

	console.log('Building hrefs list');
	const resources = await getExternalResources(page);

	console.log('Fetching hrefs', resources);
	const files = await fetchResources(resources);
	
	console.log('Update page references', files);
	await Promise.all(files.map(async(file) => {
		let key = file.href !== null ? 'href' : 'src';
		let value = file[key];
		let path = file.path;

		await page.evaluate((key, value, path) => {
			let selectcor = '['+key+'="'+value+'"]';
			console.log('Updating', selectcor, 'with', key + '=".' + path + '"');

			let elem = document.querySelector(selectcor);
			elem.setAttribute(key, '.' + path);
			elem.setAttribute('reff-orig', value);
			
			elem.removeAttribute('integrity');
			elem.removeAttribute('crossorigin');
		}, key, value, path);
		return;
	}));

	console.log('Dumping content');
	const content = await page.content();

	console.log('Building archive');
	await fsPromises.writeFile(storageFolder + host + '.html', content);

	await browser.close();
	console.log('Done, the archive is ready');
})();

/**
 * @param Page page
 * @return list of hrefs
 */
const getExternalResources = (page) => {
	return page.$$eval('link,script[src],img', nodes => 
		nodes.map(node => ({
			nodeName: node.nodeName,
			href: node.getAttribute('href'),
			src: node.getAttribute('src'),
		})
	));
}

/**
 * @param array hrefs
 * @return list of file path
 */
const fetchResources = resources => {
	return Promise.all(
		resources.map(async(resource) => {
			let url = resource.href || resource.src;
			let isRelative = !url.includes('http');
			if(isRelative) url = origin + '/' + url;

			const response = await axios.get(url);
			console.log('axios', url);
			
			let contentType = response.headers['content-type'] || 'text/plain';
			console.log('contentType', contentType);

			if(contentType.includes(';')) contentType = contentType.match(/([^;]+)/g)[0];
			console.log('contentType', contentType);

			const mime = mimes[contentType];
			const extention = mime.extensions ? mime.extensions[0] : 'html';
			console.log('extention', extention);

			const path = tempFolder + getUniq() + '.' + extention;
			console.log('path', path);

			await fsPromises.writeFile(path, response.data, 'binary');
			resource.path = path; 
			return resource;
		})
	);
}

/**
 * Get an unique name from an href
 * 
 * @param href
 * @return name
 */
const getFileNameFromHref = href => {
	const unique = Math.random().toString(36).substr(2, 8);
	const name = href.includes('/') ? href.split('/').slice().pop() : href;
	return unique + '_' + name;
}

/**
 * Get unique token 
 */
const getUniq = () => {
	return Math.random().toString(36).substr(2, 16);
}

/**
 * Get the hash of a string
 */
const hash = (url) => {
	return require('crypto').createHash('sha1').update(url).digest('base64');
}

/**
 * Delete a list of file
 * 
 * @param array files path
 */
const cleanupFiles = files =>{
	return Promise.all(
		files.map(async(file) => {
			await fsPromises.unlink(file.path);
		})
	);
}