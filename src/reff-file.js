const fs = require('fs')
const puppeteer = require('puppeteer');
const mimes = require('mime-db');
const axios = require('axios');
const crypto = require('crypto');

const url = process.argv[2];
if(!url) {console.log('Missing url parameter'); return; }

const isVerbose = process.argv[3] == '--verbose';
const log = (...msg) => {
	if(isVerbose) console.log(...msg);
}

const urlObj = new URL(url);
const urlHash = md5(urlObj.host + '/' + urlObj.pathname);
const dir = 'reffs/' + urlHash + '/';
const assets = 'assets/';
if(!fs.existsSync(dir + assets)) fs.mkdirSync(dir + assets, {recursive: true});

const red = '\x1b[31m';
const white = '\x1b[0m';

console.log('Archiving ' + url);

(async () => {
	log('Loading page...');
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setViewport({width: 1920, height: 1080});
	await page.goto(url);
	
	// Bind puppeteer console to node console
	page.on('console', obj => log(obj.text()));

	log('Building descriptors...');
	const resources = await getExternalResources(page);

	log('Fetching resources...');
	const files = await fetchResources(resources);

	log('Updating page...');
	await updateExternalResources(page, files);

	log('Dumping content...');
	const content = await page.content();

	log('Building archive...');
	await fs.promises.writeFile(dir + 'index.html', content);
	await browser.close();

	fs.promises.writeFile(dir + 'build.json', JSON.stringify({
		url: url,
		timestamp: Date.now(),
		resources: files,
	}, null, 4));

	const label = (urlObj.host + '/' + urlObj.pathname).replace(/[^\w\s]/gi, '.');
	fs.promises.writeFile(dir + label, '');

	log('Resources summary', files);
	console.log('Done, snapshot ready at', dir + 'index.html');
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
 *	path: 'assets/569ffd5a6488.ico' // local file tag,
 *	error: 'error message', // an error if something wrong happend 
 * }
 */
const getExternalResources = page => {
	const selector
		= 'link:not([rel="dns-prefetch"])' // links stylesheet
		+ ',script[src]' // only external scripts
		+ ',img[src]'; // only img with external src

	return page.$$eval(selector, tags => {
		const getUrlAttr = tag => tag.nodeName === 'LINK' ? 'href' : 'src';
		return tags.filter(tag => {
			if(!tag.nodeName) {
				console.log('Error: tag without nodeName', tag);
				return false;
			}
			const urlAttr = getUrlAttr(tag);
			if(!tag[urlAttr] || !tag.getAttribute) {
				console.log('Error: tag without getAttribute or', urlAttr, tag);
				return false;
			}
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
				const response = await axios.get(resource.url, {responseType: 'stream'});
				const extention = getFileExtention(response.headers);
				const name = md5(resource.url) + extention;
				const savePath = dir + assets + name;
				log('Saving \n -', resource.url, 'to \n -', savePath);
				await response.data.pipe(fs.createWriteStream(savePath));
				resource.file = name;
				resource.path = assets + name;
				return resource;
			} catch (error) {
				// Silently handle exception
				log(red+'Error fetching', resource.url, error.message, white);
				resource.file = resource.path = '';
				resource.error = error.message;
				return resource;
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
			if(!file.error) {
				console.log('Updating', file.type, file.attr, '\n -', file.value, 'with \n -', file.path);
				let selectcor = '['+file.attr+'="'+file.value+'"]';
				let elem = document.querySelector(selectcor);
				if(elem) {
					elem.setAttribute(file.attr, file.path);
					elem.setAttribute('orig-' + file.attr, file.value);
					// disable integrity check and allow crossorigin
					elem.removeAttribute('integrity');
					elem.removeAttribute('crossorigin');
					// remove other image sizes
					elem.removeAttribute('srcset');
				} else {
					console.log('Error: no result from selector', selectcor);
				}
			}
		});
	}, files)
}

/**
 * Get md5 from url 
 */
function md5(url) {
	return crypto.createHash('md5').update(url).digest('hex');
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