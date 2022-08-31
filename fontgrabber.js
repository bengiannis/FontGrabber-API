const puppeteer = require('puppeteer');
const request = require('request');
const express = require('express');
const FontName = require('fontname');
const woff2Parser = require('woff2-parser');
const woffParser = require('woff-parser');
const http = require('http');
const https = require('https');
const { match } = require('assert');
const { url } = require('inspector');

var debug = (process.env.DEBUG);
var logProgress = true;

var browser;

var tickets = {}

function newTicket() {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 16; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
 }
 tickets[result] = "Grabbing fonts";
 return result;
}

function setTicketProgress(ticket, progress) {
  if (ticket) {
    tickets[ticket] = progress;
  }
  else {
    ripTicket(ticket);
  }
}

function ripTicket(ticket) {
  if (tickets[ticket]) {
    delete tickets.ticket;
  }
}

function asyncRequest(url) {
  return new Promise(async function (resolve, reject) {
    try {
      const page = await browser.newPage();
      await page.setCacheEnabled(false);
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36");
      page.on('response', async response => {
        const pageContent = await response.text();
        resolve(pageContent);
      });
      await page.goto(url, {
        waitUntil: 'networkidle2'
      });
      await page.close();
    }
    catch(e) {
      if (e && e.message) {
        console.log("Error performing asyncRequest on", url, ":", e.message);
        reject({"error": "Error performing asyncRequest on " + url + " : " + e.message});
      }
      else {
        console.log("Error performing asyncRequest on", url);
        reject({"error": "Error performing asyncRequest on", url});
      }
    }
  });
}

function asyncRequestManual(url) {
  return new Promise(function (resolve, reject) {
    try {
      request({uri: url, headers: {"User-Agent": "Mozilla/5.0"}}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          resolve(body);
        } else {
          reject(error || new Error("Response " + response.statusCode + " when fetching " + url));
        }
      });
    }
    catch(e) {
      if (e && e.message) {
        console.log("Error performing asyncRequestManual on", url, ":", e.message);
        reject({"error": "Error performing asyncRequestManual on " + url + " : " + e.message});
      }
      else {
        console.log("Error performing asyncRequestManual on", url);
        reject({"error": "Error performing asyncRequestManual on " + url});
      }
    }
  });
}

function fileTypeOfUrl(url) {
  return new Promise(function (resolve, reject) {
    if (/.otf(\??|\/)/.test(url)) {
      resolve({"type": "otf"});
    }
    else if (/.ttf(\??|\/)/.test(url)) {
      resolve({"type": "ttf"});
    }
    else if (/.woff2(\??|\/)/.test(url)) {
      resolve({"type": "woff2"});
    }
    else if (/.woff(\??|\/)/.test(url)) {
      resolve({"type": "woff"});
    }
    else {
      request.head({uri: url, headers: {"User-Agent": "Mozilla/5.0"}}, function (error, response, body) {
        try {
          if (!error && response.statusCode == 200) {
            const responseHeaders = response.headers;
            if (responseHeaders && responseHeaders["content-type"]) {
              const contentType = responseHeaders["content-type"];
              var parsedFileType = `.${contentType.replace(/.+\/|;.+/g, "")}`.replace(".", "").toLowerCase();
              parsedFileType = correctMismatchedFileType(parsedFileType);
              if (isValidFontFileType(parsedFileType)) {
                resolve({"type": parsedFileType});
              }
              else {
                reject({"error": "Invalid font file type (" + parsedFileType + ") returned when checking " + url});
              }
            }
            else {
              reject({"error": "No Content-Type returned when checking file type of " + url});
            }
          }
          else {
            reject({"error": "Response " + response.statusCode + " when checking file type of " + url});
          }
        }
        catch(e) {
          if (e && e.message) {
            reject({"error": error.message});
          }
          else {
            reject({"error": "Response " + response.statusCode + " when checking file type of " + url});
          }
        }
      });
    }
  });
}

function correctMismatchedFileType(fileType) {
  if (fileType) {
    if (["font-woff2"].includes(fileType)) {
      return "woff2";
    }
    else if (["font-woff"].includes(fileType)) {
      return "woff";
    }
  }
  return fileType;
}

function isValidFontFileType(fileType) {
  return ["otf", "ttf", "woff", "woff2"].includes(fileType);
}

function doRegex(input, regex) {
  var result = input.match(regex);
  if (result.length >= 2) {
    return result[1];
  }
  else if (result.length >= 1) {
    return result[0];
  }
  return '';
}

function doRegexAll(input, regex) {
  var result = input.matchAll(regex);
  return Array.from(result, x=>x[1])
}
  /*
  console.log(input, regex);
  var matches, output = [];
  while ((matches = regex.exec(input)) != null) {
    output.push(matches[1]);
  }
  if (Array.isArray(output)) {
    if (output.length > 0) {
      output = output[0];
    }
    else {
      output = '';
    }
  }
  return output;
}*/

function isRealFont(fontName) {
  if (!fontName) {
    return false;
  }
  var notRealFonts = ["sans-serif", "serif", "cursive", "fantasy", "monospace", "initial", "inherit", "-apple-system", "blinkmacsystemfont", "system-ui"];
  var notRealFontSearches = [/font(\s?|-?)awesome/i, /webflow(\s?|-?)icons/i, /var\s?\(/i, /google(\s?|-?)sans/i, /apple(\s?|-?)icons/i, /material(\s?|-?)icons/i, /web(\s?|-?)icon(\s?|-?)font/i, /apple(\s?|-?)color(\s?|-?)emoji/i, /segoe(\s?|-?)ui(\s?|-?)emoji/i, /segoe(\s?|-?)ui(\s?|-?)symbol/i];
  for (const fontSearch of notRealFontSearches) {
    if (fontSearch.test(fontName)) {
      return false;
    }
  }
  return (!notRealFonts.includes(fontName.toLowerCase()))
}

function extractFontNamesFromLine(input) {
  //input: 'SF Pro', "Helvetica", Arial, sans-serif
  //output: ["SF Pro", "Helvetica", "Arial"]
  if (!input) {
    return {"primary": [], "fallback": []};
  }
  var individualFonts = input.split(",");
  var primaryFontNames = [];
  var fallbackFontNames = [];
  for (let i = 0; i < individualFonts.length; i++) {
    const individualFont = individualFonts[i];
    var fontName = individualFont.replace("!important", '').trim().replace(/['"]+/g, '');
    if (isRealFont(fontName)) {
      if (i == 0) {
        primaryFontNames.push(fontName);
      }
      else {
        fallbackFontNames.push(fontName);
      }
    }
  }
  return {"primary": primaryFontNames, "fallback": fallbackFontNames};
}

function extractSingleFontNameFromLine(input) {
  //input: "'SF Pro'"
  //output: "SF Pro"
  if (!input) {
    return null;
  }
  var fontName = input.replace("!important", '').trim().replace(/['"]+/g, '');
  return fontName;
}

function directUrlGivenRelativeUrl(relativePath, urlToFetch) {
  urlToFetch = urlToFetch.trim().replace(/\/+$/, '');
  if (Array.isArray(urlToFetch)) {
    urlToFetch = urlToFetch[0];
  }
  if (!urlToFetch || !relativePath) {
    return urlToFetch;
  }
  urlToFetch = urlToFetch.replace(/\/+$/, '');
  relativePath = relativePath.trim().replace(/['"]+/g, '').trim();
  if (relativePath.startsWith("/")) {
    var pathArray = urlToFetch.split('/');
    return pathArray[0] + '//' + pathArray[2] + relativePath;
  }
  else if (relativePath.startsWith("../")) {
    //stylesheet: https://fontgrabber.com/example
    //font: ../hello
    urlToFetch = doRegex(urlToFetch, /(.*)\//);
    while (relativePath.startsWith("../")) {
      urlToFetch = doRegex(urlToFetch, /(.*)\//);
      relativePath = doRegex(relativePath, /..\/(.*)/);
    }
    return urlToFetch + "/" + relativePath;
  }
  else if (relativePath.startsWith("./")) {
    //stylesheet: https://fontgrabber.com/example
    //font: ./hello
    return doRegex(urlToFetch, /(.*)\//) + "/" + doRegex(relativePath, /.\/(.*)/);
  }
  else if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  else {
    return doRegex(urlToFetch, /(.*)\//) + "/" + relativePath;
  }
}

function isValidHttpUrl(string) {
  let url;
  
  try {
    url = new URL(string);
  }
  catch(_) {
    return false;  
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

async function getFontFileBufferFromUrl(fontUrl) {
  return new Promise((resolve, reject) => {
    if (fontUrl.startsWith("https")) {
      https.get(fontUrl, function(res) {
        var data = [];
        res.on('data', function(chunk) {
          data.push(chunk);
        }).on('end', function() {
          var buffer = Buffer.concat(data);
          resolve(buffer);
        });
      }).on('error', function(e) {
        reject(e);
      });
    }
    else {
      http.get(fontUrl, function(res) {
        var data = [];
        res.on('data', function(chunk) {
          data.push(chunk);
        }).on('end', function() {
          var buffer = Buffer.concat(data);
          resolve(buffer);
        });
      }).on('error', function(e) {
        reject(e);
      });
    }
  });
}

async function parseFontNameFromUrl(fontUrl) {
  try {
    var fileType = await fileTypeOfUrl(fontUrl);
    if (!fileType || fileType["error"] || !fileType["type"]) {
      return {"error": fileType["error"]};
    }
    else if (isValidFontFileType(fileType["type"])) {
      fileType = fileType["type"];
      if ((fileType == "otf") || (fileType == "ttf")) {
        const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
        const fontInfo = FontName.parse(fontFileBuffer)[0];

        if (fontInfo && fontInfo["fullName"]) {
          var parsedFontName = fontInfo["fullName"];
          return {"name": parsedFontName};
        }
        else {
          throw new Exception("Could not parse font name using FontName");
        }
      }
      else if (fileType == "woff2") {
        const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
        const fontInfo = await woff2Parser(fontFileBuffer);

        if (fontInfo && fontInfo["name"]["nameRecords"]["English"]["fullName"]) {
          var parsedFontName = fontInfo["name"]["nameRecords"]["English"]["fullName"];
          return {"name": parsedFontName};
        }
        else {
          throw new Exception("Could not parse font name using woff2-parser");
        }
      }
      else if (fileType == "woff") {
        const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
        const fontInfo = await woffParser(fontFileBuffer);

        if (fontInfo && fontInfo["name"]["nameRecords"]["English"]["fullName"]) {
          var parsedFontName = fontInfo["name"]["nameRecords"]["English"]["fullName"];
          return {"name": parsedFontName};
        }
        else {
          throw new Exception("Could not parse font name using woff-parser");
        }
      }
    }
    else {
      return await parseFontNameFromUnknownUrl(fontUrl);
    }
  }
  catch(e) {
    try {
      return await parseFontNameFromUnknownUrl(fontUrl);
    }
    catch(e) {
      if (e && e.message) {
        return {"error": e.message};
      }
      else {
        return {"error": "Could not parse font name from url"};
      }
    }
  }
}

async function parseFontNameFromUnknownUrl(fontUrl) {
  try {
    const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
    const fontInfo = FontName.parse(fontFileBuffer)[0];

    if (fontInfo && fontInfo["fullName"]) {
      var parsedFontName = fontInfo["fullName"];
      return {"name": parsedFontName};
    }
    else {
      throw new Exception("Could not parse font name using FontName from unknown url");
    }
  } catch (e) {
    try {
      const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
      const fontInfo = await woff2Parser(fontFileBuffer);

      if (fontInfo && fontInfo["name"]["nameRecords"]["English"]["fullName"]) {
        var parsedFontName = fontInfo["name"]["nameRecords"]["English"]["fullName"];
        return {"name": parsedFontName};
      }
      else {
        throw new Exception("Could not parse font name using woff2-parser from unknown url");
      }
    } catch (e) {
      try {
        const fontFileBuffer = await getFontFileBufferFromUrl(fontUrl);
        const fontInfo = await woffParser(fontFileBuffer);

        if (fontInfo && fontInfo["name"]["nameRecords"]["English"]["fullName"]) {
          var parsedFontName = fontInfo["name"]["nameRecords"]["English"]["fullName"];
          return {"name": parsedFontName};
        }
        else {
          throw new Exception("Could not parse font name using woff-parser from unknown url");
        }
      } catch (e) {
        if (e && e.message) {
          return {"error": e.message};
        }
        else {
          return {"error": "Could not parse font name from unknown url"};
        }
      }
    }
  }
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function grabFonts(ticket, urlToFetch) {
  try {
    setTicketProgress(ticket, "Loading website...");
    if (logProgress) {
      console.log("Creating new page");
    }
    const page = await browser.newPage();
    
    await page.setCacheEnabled(false);

    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36")

    if (logProgress) {
      console.log("Loading", urlToFetch);
    }

    await page.goto(urlToFetch, {
      waitUntil: 'networkidle2'
    });

    if (logProgress) {
      console.log("Done loading", urlToFetch);
    }
    
    /*await page.goto(urlToFetch, {
      waitUntil: 'networkidle0',
    });*/
/*
    await page.waitForNavigation({
      waitUntil: 'networkidle0',
    });*/

    //await timeout(4000);
    

    /*let allDocumentContent = await page.evaluate(() => {
      try {
        return document.documentElement.innerHTML;
      }
      catch(e) {
        console.log("Error (allDocumentContent):", e.message);
        return {"error": "Error", "errorMessage": e.message};
      }
    });
    console.log("All Document Content:", allDocumentContent);*/

    setTicketProgress(ticket, "Loading stylesheets...");
    if (logProgress) {
      console.log("Loading externalCSSPages");
    }
    let externalCSSPages = await page.evaluate(() => {
      try {
        const allCssStyleSheetsLinks = [];
        const stylesheets = document.styleSheets;
        for (let i = 0; i < stylesheets.length; i++) {
          if (stylesheets[i].href) {
            allCssStyleSheetsLinks.push(stylesheets[i].href);
          }
        }
        return allCssStyleSheetsLinks;
      }
      catch(e) {
        console.log("Error (externalCSSPages):", e.message);
        return {"error": "Error parsing external CSS content", "errorMessage": e.message};
      }
    });
    if (logProgress) {
      console.log("Done loading externalCSSPages");
      console.log("Loading internalCSSContent");
    }
    let internalCSSContent = await page.evaluate(() => {
      try {
        var allCssStyleTagContent = [];
        const styleTags = document.getElementsByTagName('style');
        if (styleTags) {
          for (let i = 0; i < styleTags.length; i++) {
            allCssStyleTagContent.push(styleTags[i].innerHTML);
          }
        }
        return allCssStyleTagContent;
      }
      catch(e) {
        console.log("Error (internalCSSContent):", e.message);
        return {"error": "Error parsing internal CSS content", "errorMessage": e.message};
      }
    });
    if (logProgress) {
      console.log("Done loading internalCSSContent");
      console.log("Loading inlineCSSContent");
    }
    let inlineCSSContent = await page.evaluate(() => {
      try {
        var allCssInlineContent = [];
        const allTags = document.getElementsByTagName('*');
        if (allTags) {
          for (let i = 0; i < allTags.length; i++) {
            if (allTags[i].hasAttribute("style")) {
              allCssInlineContent.push("#inlineElement" + i + " {\n" + allTags[i].getAttribute("style") + "\n}");
            }
          }
        }
        return allCssInlineContent;
      }
      catch(e) {
        console.log("Error (inlineCSSContent):", e.message);
        return {"error": "Error parsing inline CSS content", "errorMessage": e.message};
      }
    });
    if (logProgress) {
      console.log("Done loading inlineCSSContent");
    }
    let importedCSSPages = [];

    var fontFaceInstances = []
    var fontFamilyInstances = []

    setTicketProgress(ticket, "Parsing stylesheets...");
    if (logProgress) {
      console.log("Parsing externalCSSPages");
    }
    for (const externalCSSPage of externalCSSPages) {
      try {
        var externalCSSPageContent;
        if (externalCSSPage.includes("://fonts.googleapis.com")) {
          externalCSSPageContent = await asyncRequestManual(externalCSSPage);
        }
        else {
          externalCSSPageContent = await asyncRequest(externalCSSPage);
        }
        var fontFacesInContent = doRegexAll(externalCSSPageContent, /@font-face\s?{((.|\n)*?)}/g);
        var fontFamiliesInContent = doRegexAll(externalCSSPageContent, /font-family\s?:\s((.|\n)*?)(;|})/g);
        for (const fontFaceInContent of fontFacesInContent) {
          fontFaceInstances.push({"url": externalCSSPage, "content": fontFaceInContent});
        }
        for (const fontFamilyInContent of fontFamiliesInContent) {
          fontFamilyInstances.push({"url": externalCSSPage, "content": fontFamilyInContent});
        }
        var moreImportedCSSPages = doRegexAll(externalCSSPageContent, /@import\s?url\((.*?)\)/g);
        if (moreImportedCSSPages) {
          for (const moreImportedCSSPage of moreImportedCSSPages) {
            importedCSSPages.push(moreImportedCSSPage.trim().replace(/['"]+/g, ''));
          }
        }
      }
      catch(e) {
        console.log("Error fetching and/or parsing externalCSSPage:", e.message);
      }
    }
    if (logProgress) {
      console.log("Done parsing externalCSSPages");
      console.log("Parsing internalCSSContent");
    }
    for (const internalCSS of internalCSSContent) {
      try {
        var fontFacesInContent = doRegexAll(internalCSS, /@font-face\s?{((.|\n)*?)}/g);
        var fontFamiliesInContent = doRegexAll(internalCSS, /font-family\s?:\s((.|\n)*?)(;|})/g);
        for (const fontFaceInContent of fontFacesInContent) {
          fontFaceInstances.push({"url": urlToFetch, "content": fontFaceInContent});
        }
        for (const fontFamilyInContent of fontFamiliesInContent) {
          fontFamilyInstances.push({"url": urlToFetch, "content": fontFamilyInContent});
        }
        var moreImportedCSSPages = doRegexAll(internalCSS, /@import\s?url\((.*?)\)/g);
        if (moreImportedCSSPages) {
          for (const moreImportedCSSPage of moreImportedCSSPages) {
            importedCSSPages.push(moreImportedCSSPage.trim().replace(/['"]+/g, ''));
          }
        }
      }
      catch(e) {
        console.log("Error parsing internalCSSContent:", e.message);
      }
    }
    if (logProgress) {
      console.log("Done parsing internalCSSContent");
      console.log("Parsing importedCSSPages");
    }
    for (let i = 0; i < importedCSSPages.length; i++) {
      const importedCSSPage = importedCSSPages[i];
      try {
        var importedCSSPageContent;
        if (importedCSSPage.includes("://fonts.googleapis.com")) {
          importedCSSPageContent = await asyncRequestManual(importedCSSPage);
        }
        else {
          importedCSSPageContent = await asyncRequest(importedCSSPage);
        }
        var fontFacesInContent = doRegexAll(importedCSSPageContent, /@font-face\s?{((.|\n)*?)}/g);
        var fontFamiliesInContent = doRegexAll(importedCSSPageContent, /font-family\s?:\s((.|\n)*?)(;|})/g);
        for (const fontFaceInContent of fontFacesInContent) {
          fontFaceInstances.push({"url": importedCSSPage, "content": fontFaceInContent});
        }
        for (const fontFamilyInContent of fontFamiliesInContent) {
          fontFamilyInstances.push({"url": importedCSSPage, "content": fontFamilyInContent});
        }
        var moreImportedCSSPages = doRegexAll(importedCSSPageContent, /@import\s?url\((.*?)\)/g);
        if (moreImportedCSSPages) {
          for (const moreImportedCSSPage of moreImportedCSSPages) {
            importedCSSPages.push(moreImportedCSSPage.trim().replace(/['"]+/g, ''));
          }
        }
      }
      catch(e) {
        console.log("Error fetching and/or parsing importedCSSPage:", e.message);
      }
    }
    if (logProgress) {
      console.log("Done parsing importedCSSPages");
      console.log("Parsing inlineCSSContent");
    }
    for (const inlineCss of inlineCSSContent) {
      try {
        var fontFacesInContent = doRegexAll(inlineCss, /@font-face\s?{((.|\n)*?)}/g);
        var fontFamiliesInContent = doRegexAll(inlineCss, /font-family\s?:\s((.|\n)*?)(;|})/g);
        for (const fontFaceInContent of fontFacesInContent) {
          fontFaceInstances.push({"url": urlToFetch, "content": fontFaceInContent});
        }
        for (const fontFamilyInContent of fontFamiliesInContent) {
          fontFamilyInstances.push({"url": urlToFetch, "content": fontFamilyInContent});
        }
      }
      catch(e) {
        console.log("Error parsing inlineCSSContent:", e.message);
      }
    }
    if (logProgress) {
      console.log("Done parsing inlineCSSContent");
    }

    //console.log(externalCSSPages, internalCSSContent, inlineCSSContent);

    var primaryFonts = [];
    var fallbackFonts = [];

    var totalFontsFound = 0;

    setTicketProgress(ticket, "Grabbing fonts...");
    if (logProgress) {
      console.log("Finding fontFaceInstances");
    }
    for (let i = 0; i < fontFaceInstances.length; i++) {
      const fontFaceInstanceItem = fontFaceInstances[i];
      const fontFaceInstance = fontFaceInstanceItem["content"];
      const fontFaceCssSource = fontFaceInstanceItem["url"];

      var fontFaceName = doRegexAll(fontFaceInstance, /font-family\s?:\s?(.*?);/g);
      var fontFaceURL = doRegexAll(fontFaceInstance, /url\((.*?)\)/g);
      var fontFaceWeight = "400";
      if (fontFaceInstance.includes("font-weight")) {
        fontFaceWeight = doRegexAll(fontFaceInstance, /font-weight\s?:\s?(.*?);/g);
      }

      if (Array.isArray(fontFaceName)) {
        fontFaceName = fontFaceName[0];
      }
      if (Array.isArray(fontFaceURL)) {
        fontFaceURL = fontFaceURL[0];
      }
      if (Array.isArray(fontFaceWeight)) {
        fontFaceWeight = fontFaceWeight[0];
      }

      var fontFaceWeightValue;
      if (fontFaceWeight) {
        fontFaceWeight = fontFaceWeight.trim();
        if ((fontFaceWeight.toLowerCase() == "regular") || (fontFaceWeight.toLowerCase() == "normal")) {
          fontFaceWeightValue = "400";
        }
        else if (fontFaceWeight.toLowerCase() == "bold") {
          fontFaceWeightValue = "700";
        }
        else {
          fontFaceWeightValue = fontFaceWeight.toString();
        }
      }

      if (fontFaceName && fontFaceName.length > 0) {
        fontFaceName = extractSingleFontNameFromLine(fontFaceName);
        if (!isRealFont(fontFaceName)) {
          continue;
        }
        if (fontFaceURL && fontFaceURL.length > 0) {
          fontFaceURL = fontFaceURL.replace("\\ ", "%20");
          fontFaceURL = directUrlGivenRelativeUrl(fontFaceURL, fontFaceCssSource);

          var parsedFontName = await parseFontNameFromUrl(fontFaceURL);
          if (parsedFontName && !("error" in parsedFontName) && (parsedFontName["name"].toLowerCase() != "undefined") && (![".\x7F"].includes(parsedFontName["name"]))) {
            parsedFontName = parsedFontName["name"];
          }
          else {
            console.log("Error parsing font name:", parsedFontName["error"]);
            parsedFontName = fontFaceName + " (" + fontFaceWeightValue + ")";
          }

          if (!isRealFont(parsedFontName)) {
            continue;
          }

          var parsedFontFileType = "undefined"; 
          try {
            parsedFontFileType = await fileTypeOfUrl(fontFaceURL);
            if (parsedFontFileType && parsedFontFileType["type"]) {
              parsedFontFileType = parsedFontFileType["type"];
            }
          }
          catch(e) {
            console.log("Error parsing font file type:", parsedFontFileType["type"]);
            //continue;
          }

          /*if (!primaryFonts.some(e => (e["name"] == fontFaceName && e["src"] == fontFaceURL))) {
            primaryFonts.push({"name": fontFaceName, "full_name": parsedFontName, "src": fontFaceURL, "weight": fontFaceWeightValue});
          }*/
          if (primaryFonts.some(e => (e["name"] == fontFaceName))) {
            //font already in list
            //[{name=fontname, variants=[ {weight=400, src = skjdnfkjnsdfn} ] }]
            if (!(primaryFonts.some(font => (font["variants"].some(variant  => (variant["src"] == fontFaceURL)))))) {
              const existingFontDict = primaryFonts.find(font => font["name"] == fontFaceName);
              existingFontDict["variants"].push({"full_name": parsedFontName, "src": fontFaceURL, "weight": fontFaceWeightValue, "type": parsedFontFileType});
              totalFontsFound += 1;
            }
          }
          else {
            primaryFonts.push({"name": fontFaceName, "variants": [{"full_name": parsedFontName, "src": fontFaceURL, "weight": fontFaceWeightValue, "type": parsedFontFileType}]});
            totalFontsFound += 1;
          }
        }
        else {
          if (!primaryFonts.some(e => e["name"] == fontFaceName) &&!fallbackFonts.some(e => e["name"] == fontFaceName)) {
            fallbackFonts.push({"name": fontFaceName, "variants": [{"full_name": fontFaceName}]});
            totalFontsFound += 1;
          }
        }
      }
    }
    if (logProgress) {
      console.log("Done finding fontFaceInstances");
      console.log("Finding fontFamilyInstances");
    }
    for (let i = 0; i < fontFamilyInstances.length; i++) {
      const fontFamilyLineItem = fontFamilyInstances[i];
      const fontFamilyLine = fontFamilyLineItem["content"];

      var fontFaceNames = extractFontNamesFromLine(fontFamilyLine);
      for (let j = 0; j < fontFaceNames["primary"].length; j++) {
        var fontFaceName = fontFaceNames["primary"][j];
        if (!primaryFonts.some(e => e["name"] == fontFaceName) && !fallbackFonts.some(e => e["name"] == fontFaceName)) {
            fallbackFonts.push({"name": fontFaceName, "variants": [{"full_name": fontFaceName}]});
            totalFontsFound += 1;
        }
      }
      for (let j = 0; j < fontFaceNames["fallback"].length; j++) {
        var fontFaceName = fontFaceNames["fallback"][j];
        if (!primaryFonts.some(e => e["name"] == fontFaceName) && !fallbackFonts.some(e => e["name"] == fontFaceName)) {
            fallbackFonts.push({"name": fontFaceName,  "variants": [{"full_name": fontFaceName}]});
            totalFontsFound += 1;
        }
      }
    }
    if (logProgress) {
      console.log("Done finding fontFamilyInstances");
    }

    await page.close();

    console.log("Success:", urlToFetch, "->", totalFontsFound, "font" + ((totalFontsFound.length == 1) ? "" : "s"), "found")
    return {"stylesheets": {"external": externalCSSPages.length, "internal": internalCSSContent.length, "inline": inlineCSSContent.length}, "fonts": {"primary": primaryFonts, "fallback": fallbackFonts}, "total": totalFontsFound};
  }
  catch(e) {
    console.log("Error (entire async):", e.message)
    if (e && e.message && e.message.includes("ERR_NAME_NOT_RESOLVED")) {
      return {"error": "Error loading webpage", "errorMessage": e.message};
    }
    else {
      return {"error": "Error grabbing fonts", "errorMessage": e.message};
    }
  }
};


const app = express();

const hostname = '127.0.0.1';
const port = 8080;

app.get('/', (req, res) => res.send("FontGrabber API is running"));

app.get('/fonts', async function(req, res) {
  if (!browser) {
    if (logProgress) {
      console.log("Starting browser");
    }
    browser = await puppeteer.launch({
      headless: true
    });
  }
  var urlToFetch = req.query.url;
  var ticket = req.query.ticket;
  if (urlToFetch && !urlToFetch.startsWith("http") && urlToFetch.includes(".")) {
    urlToFetch = "http://" + urlToFetch
  }
  if (urlToFetch && isValidHttpUrl(urlToFetch)) {
    try {
      console.log("Grabbing", urlToFetch);
      var fonts = await grabFonts(ticket, urlToFetch);
      res.send(fonts);
    }
    catch(e) {
      res.send({"error": "Error grabbing fonts", "errorMessage": e.message});
    }
  }
  else {
    res.send({"error": "Error grabbing fonts", "errorMessage": "Invalid URL"});
  }
  if (ticket) {
    ripTicket(ticket);
  }
});

app.get('/tabs', async function(req, res) {
  var openTabs = [];
  if (browser) {
    openTabs = await browser.pages();
  }
  res.send({"tabs": openTabs.length});
});

app.get('/ticket', async function(req, res) {
  const ticket = newTicket();
  res.send({"ticket": ticket});
});

app.get('/tickets', async function(req, res) {
  res.send({"tickets": tickets.length});
});

app.get('/progress', async function(req, res) {
  var ticket = req.query.ticket;
  if (ticket) {
    if (ticket in tickets) {
      res.send({"progress": tickets[ticket]});
    }
    else {
      res.send({"error": "Invalid ticket"});
    }
  }
  else {
    res.send({"error": "No ticket provided"});
  }
});

app.listen(port, function() {
  console.log(`Server running at http://${hostname}:${port}/`);
});
