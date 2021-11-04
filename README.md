# Hypershot: standalone hypertext snapshots

Hypershot let's you make standalone copy (they work offline) of websites. It works both as node module and as command line tool. It's part of `reff` project.

## CLI
### Install
You can install the hypershot command line via `yarn`:
```
yarn global add https://github.com/b1n01/hypershot.git
```

### Usage
To create a snapshot: 
```
hypershot {url} {folder}
```

To enable log use the `DEBUG` environment variable:
```
DEBUG=true hypershot {url} {folder}
```

### Example
Create a copy of `https://news.ycombinator.com/` and store it on `hacker-news` folder:
```
hypershot https://news.ycombinator.com/ hacker-news
```

## Node module
### Install
You can install the hypershot command line via yarn:
```
yarn add https://github.com/b1n01/hypershot.git
```

### Example
You can create a snapshot via the the hypershot function:
```
const hypershot = require("hypershot");

hypershot("https://news.ycombinator.com/", "hacker-news")
	.then(path => console.log(path));
```

## How it works
It uses [puppeteer](https://pptr.dev/) to render websites, then goes through all external resources (href, src, ecc..) and tries to replace them with local copies. It detects the assets mime-type from the http response content-type. In the end, hopefully, you will find an index.html that is an exact copy of the given url but it is entirely stored locally.

## Issues
Hypershot is still in beta, some feature are missing and it may break some times, please open issues or pull requests if you find problems or want to help.
