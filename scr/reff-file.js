const puppeteer = require('puppeteer');
const fs = require('fs')
const fsPromises = require('fs').promises;
const axios = require('axios');

const url = process.argv[2];
if(!url) { console.log('Missing url parameter'); return; }

const tempFolder = './.tmp/';
const storageFolder = './storage/';
if(!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);
if(!fs.existsSync(storageFolder)) fs.mkdirSync(storageFolder);

console.log('Archiving ' + url);

const origin = (new URL(url)).origin;
const host = (new URL(url)).host;

(async () => {
	console.log('Inizializing puppeteer');
	const browser = await puppeteer.launch();
	
	console.log('Opening new page');
	const page = await browser.newPage();
	
	// Bind puppeteer console to node console
	page.on('console', obj => console.log(obj.text()));

	console.log('Loading target url');
	await page.goto(url);

	console.log('Building resources list');
	const hrefs = await getStylesheets(page);

	console.log('Fetching resources', hrefs);
	const files = await fetchResources(hrefs);

	console.log('Removing old tags from page');
	await page.evaluate(() => document.querySelectorAll('link[rel="stylesheet"]').forEach(item => item.remove()));
	
	console.log('Injecting new tags');
	await Promise.all(files.map(async(file) => {
		await page.addStyleTag({path: file});
		fsPromises.unlink(file);
	}));

	console.log('Retrivering page content');
	const content = await page.content();

	console.log('Writing file');
	await fsPromises.writeFile(storageFolder + host + '.html', content);

	await browser.close();
	fs.rmdirSync(tempFolder);
	console.log('Done');
})();

/**
 * Get 'href' of all tag <link> with rel=stylesheet.
 * Hrefs are always absolute.
 *  
 * @param Page page
 * @return list of hrefs
 */
const getStylesheets = (page) => {
	return page.$$eval('link[rel="stylesheet"]', 
		links => links.map(link => {
			let href = link.getAttribute('href');
			let isRelative = !href.includes('http');
			if(isRelative) href = origin + '/' + href;
			return href;
		}
	));
}

/**
 * Fetch a list of file and store them on a temporary folder.
 * It returns the list of paths of the files.
 * 
 * @param array hrefs
 * @return list of file path
 */
const fetchResources = (hrefs) => {
	return Promise.all(
		hrefs.map(async(href) => {
			const fileName = getFileNameFromHref(href);
			const path = tempFolder + fileName;
			const response = await axios.get(href);
			await fsPromises.writeFile(path, response.data, 'binary');
			return path;
		})
	);
}

/**
 * Get an unique name from an href
 * 
 * @param href
 * @return name
 */
const getFileNameFromHref = (href) => {
	const time = (new Date()).getTime();
	const name =  href.split('/').slice().pop();
	return time + '_' + name;
}