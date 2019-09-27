const puppeteer = require('puppeteer');
const fs = require('fs')
const fsPromises = require('fs').promises;
const mimes = require('mime-db');
const axios = require('axios');
const forge = require('node-forge');

const url = process.argv[2];
if(!url) { console.log('Missing url parameter'); return; }

const dir = 'reffs/' + (new URL(url)).host + '/';
const assets = 'assets/';
if(!fs.existsSync(dir)) fs.mkdirSync(dir + assets, {recursive: true});

(async () => {
	console.log('Archiving ' + url);
	console.log('Loading page');
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.goto(url);
	
	// Bind puppeteer console to node console
	page.on('console', obj => console.log(obj.text()));

	console.log('Building external resource list');
	const resources = await getExternalResources(page);

	console.log('Fetching external resources');
	const files = await fetchResources(resources);
	
	console.log('Updating page references');
	await updateExternalResources(page, files);

	console.log('Dumping content');
	const content = await page.content();

	console.log('Building archive');
	await fsPromises.writeFile(dir + '/index.html', content);

	await browser.close();
	console.log('Done, the archive is ready');
})();

/**
 * Get info about external resources of the given page
 * 
 * @param Page page
 * @return list of node info
 */
const getExternalResources = page => {
	return page.$$eval('link,script[src],img', nodes => 
		nodes.map(node => {
			const type = node.nodeName === 'LINK' ? 'href' : 'src';
			console.log('Parsing', node.nodeName, 'with', node.getAttribute(type));
			return {
				node: node.nodeName,
				type: type,
				attr: node.getAttribute(type),
				url: node[type],
			}
		})
	);
}

/**
 * @param array hrefs
 * @return list of file path
 */
const fetchResources = resources => {
	return Promise.all(
		resources.map(async(resource) => {
			const response = await axios.get(resource.url);
			const headers = response.headers;
			const type = (headers['content-type'] || 'text/plain').match(/([^;]+)/g)[0];
			const extention = mimes[type].extensions ? '.' + mimes[type].extensions[0] : '';
			const name = md5(resource.url) + extention;
			const savePath = dir + assets + name;
			console.log('Saving', resource.url, 'to', savePath);
			await fsPromises.writeFile(savePath, response.data, 'binary');
			resource.file = name;
			resource.path = assets + name;
			return resource;
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
updateExternalResources = (page, files) => {
	return new Promise(resolve => 
		files.forEach(async(file) => {
			await page.evaluate(file => {
				let selectcor = '['+file.type+'="'+file.attr+'"]';
				console.log('Updating', selectcor, 'with', file.type + '=".' + file.path + '"');
				let elem = document.querySelector(selectcor);
				elem.setAttribute(file.type, file.path);
				elem.setAttribute('orig-' + file.type, file.attr);
				// disable integrity check, why is this needed?
				elem.removeAttribute('integrity');
			}, file);
			resolve(); 
		})
	);
}

/**
 * Get md5 from url 
 */
const md5 = (url) => {
	return forge.md.md5.create().update(url).digest().toHex();
}