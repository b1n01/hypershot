const fs = require('fs')
const puppeteer = require('puppeteer');
const mimes = require('mime-db');
const axios = require('axios');
const crypto = require('crypto');
const assetsDir = 'assets/';

// Debug stuff
const red = '\x1b[31m';
const white = '\x1b[0m';
const error = (...msg) => debug(red, ...msg, white);
const debug = (...msg) => { if (process.env.DEBUG) console.log('[hypershot]', ...msg); }

/**
 * Archive an url and store it in path
 * 
 * @param url The website to archive
 * @param path The path where to store the archive
 */
module.exports = async(url, path) =>
{
	url = new URL(url);
	path = path.endsWith('/') ? path : path + '/';
	const index = path + 'index.html';
	const build = path + 'build.json'; 

	if (!fs.existsSync(path + assetsDir)) {
		fs.mkdirSync(path + assetsDir)
	}

	/**
	 * Put all the things in a try catch to silently handle errors
	 * and follow the "something is better than nothing" logic
	 */
	try {
		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		await page.exposeFunction('debug', debug);
		await page.exposeFunction('error', error);
		await page.goto(url.href);

		const descriptors = await getDescriptors(page);
		const files = await fetchResources(descriptors, path);
		await updateExternalResources(page, files);
		const content = await page.content();
		await browser.close();

		await fs.promises.writeFile(index, content);
		await fs.promises.writeFile(build, getBuild(url, files));	
	} catch (err) {
		error(err.message);
	}

	return index;
}; 


/**
 * Get resources description for a page
 * 
 * @param Page page
 * @return list of resource descriptor like:
 * 
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
const getDescriptors = page => {
	const selector
		= 'link:not([rel="dns-prefetch"])' // links stylesheet
		+ ',script[src]' // only external scripts
		+ ',img[src]'; // only img with external src

	return page.$$eval(selector, tags => {
		const getUrlAttr = tag => tag.nodeName === 'LINK' ? 'href' : 'src';
		
		return tags.filter(tag => {
			const urlAttr = getUrlAttr(tag);
			const url = new URL(tag[urlAttr]);
			const isHttp = url.protocol.includes('http');
			window.debug('Filtering', url.href, isHttp ? 'ok' : 'removed');
			return isHttp;
		}).map(tag => {
			const urlAttr = getUrlAttr(tag);
			window.debug('Parsing', tag.nodeName, 'with', urlAttr, '=', tag[urlAttr]);
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
function fetchResources(descriptors, path) {
	return Promise.all(
		descriptors.map(async(descriptor) => {
			try {
				const response = await axios.get(descriptor.url, {responseType: 'stream'});
				const extention = getFileExtention(response.headers);
				const name = md5(descriptor.url) + extention;
				const savePath = path + assetsDir + name;
				debug('Saving', descriptor.url);
				await response.data.pipe(fs.createWriteStream(savePath));
				descriptor.file = name;
				descriptor.path = assetsDir + name;
				return descriptor;
			} catch (err) {
				error('Error fetching', descriptor.url, err.message);
				descriptor.file = descriptor.path = '';
				descriptor.error = err.message;
				return descriptor;
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
				window.debug('Updating', file.type, file.attr, file.value, 'with', file.path);
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
					window.error('No result from selector', selectcor);
				}
			}
		});
	}, files)
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

/**
 * Get md5 from url 
 */
function md5(url) {
	return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Get the "build" file content
 * 
 * @param url The archived url
 * @param files List of fetched files 
 */
const getBuild = (url, files) => {
	return JSON.stringify({
		url: url,
		timestamp: Date.now(),
		resources: files,
	}, null, 4)
}