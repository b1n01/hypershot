const fs = require('fs')
const puppeteer = require('puppeteer');
const mimes = require('mime-db');
const axios = require('axios');
const forge = require('node-forge');

const url = process.argv[2];
if(!url) { console.log('Missing url parameter'); return; }

const isVerbose = process.argv[3] == '--verbose';
const log = (...msg) => {
	if(isVerbose) console.log(...msg);
}

const dir = 'reffs/' + (new URL(url)).host + '/';
const assets = 'assets/';
if(!fs.existsSync(dir)) fs.mkdirSync(dir + assets, {recursive: true});

(async () => {
	console.log('Archiving ' + url);
	console.log('Loading page...');
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setViewport({width: 1920, height: 1080});
	await page.goto(url);
	
	// Bind puppeteer console to node console
	page.on('console', obj => log(obj.text()));

	console.log('Building descriptors...');
	const resources = await getExternalResources(page);

	console.log('Fetching resources...');
	const files = await fetchResources(resources);

	console.log('Updating page...');
	await updateExternalResources(page, files);

	console.log('Dumping content...');
	const content = await page.content();

	console.log('Building archive...');
	await fs.promises.writeFile(dir + '/index.html', content);
	await browser.close();

	await fs.promises.writeFile(dir + '/build.json', JSON.stringify({
		url: url,
		timestamp: Date.now(),
	}));

	log('Resources summary', files);
	console.log('Done, archive ready');
})();

/**
 * Get resources description for a page
 * 
 * @param Page page
 * @return list of resource descriptor like:
 * {
 *	type: 'LINK', // dom tag type
 *	attr: 'href', // dom tag attribute name
 *	value: 'favicon.ico', // dom tag attribute value
 *	url: 'https://example.com/favicon.ico', // dom tag url
 *	file: '569ffd5a6488.ico', // local file name
 *	path: 'assets/569ffd5a6488.ico' // local file tag
 * }
 */
const getExternalResources = page => {
	const selector
		= 'link[rel="stylesheet"]' // links stylesheet
		+ ',script[src]' // only external scripts
		+ ',img[src]'; // only img with external src

	return page.$$eval(selector, tags => {
		const getUrlAttr = tag => tag.nodeName === 'LINK' ? 'href' : 'src';
		return tags.filter(tag => {
			const urlAttr = getUrlAttr(tag);
			const url = new URL(tag[urlAttr]);
			const isHttp = url.protocol.includes('http');
			console.log('Filtering', url.href, isHttp ? 'ok' : 'removed');
			return isHttp;
		}).map(tag => {
			const urlAttr = getUrlAttr(tag);
			console.log('Parsing', tag.nodeName, 'with', urlAttr, '=', tag[urlAttr]);
			return {
				type: tag.nodeName,
				attr: urlAttr,
				value: tag.getAttribute(urlAttr),
				url: tag[urlAttr],
			}
		})
	});
}

/**
 * Fetch external resources and save them to assets dir
 * 
 * @param resource descriptors
 * @return resource descriptors
 */
function fetchResources(resources) {
	return Promise.all(
		resources.map(async(resource) => {
			try {
				const response = await axios.get(resource.url);
				const extention = getFileExtention(response.headers);
				const name = md5(resource.url) + extention;
				const savePath = dir + assets + name;
				log('Saving \n -', resource.url, 'to \n -', savePath);
				await fs.promises.writeFile(savePath, response.data, 'binary');
				resource.file = name;
				resource.path = assets + name;
				return resource;
			} catch (error) {
				log('Error fetching', resource.url);
				//throw error;
			}
		})
	);
}

/**
 * Update the dom elements on the page to use local resources
 * 
 * @param page
 * @param files
 * @return Promise
 */
function updateExternalResources(page, files) {
	return page.evaluate(files => {
		files.map(file => {
			console.log('Updating', file.type, file.attr, '\n -', file.value, 'with \n -', file.path);
			let selectcor = '['+file.attr+'="'+file.value+'"]';
			let elem = document.querySelector(selectcor);
			if(elem) {
				elem.setAttribute(file.attr, file.path);
				elem.setAttribute('orig-' + file.attr, file.value);
				// disable integrity check, why is this needed?
				//elem.removeAttribute('integrity');
				// remove other image sizes
				//elem.removeAttribute('srcset');
			} else {
				console.log('Cannot find', selectcor);
			}
		});
	}, files)
}

/**
 * Get md5 from url 
 */
function md5(url) {
	return forge.md.md5.create().update(url).digest().toHex();
}

/**
 * Get file extention from response headers
 * 
 * @param headers
 * @return extention 
 */
function getFileExtention(headers) {
	const type = (headers['content-type'] || 'text/plain').match(/([^;]+)/g)[0];
	return mimes[type] && mimes[type].extensions ? '.' + mimes[type].extensions[0] : '';
}