import fs from "fs-extra";
import pify from "pify";

export const withoutTrailingSlash = (path) => {
    path === "/" ? path : path.replace(/\/$/, "");
};

export const writeFile = pify(fs.writeFile);
export const outputFile = pify(fs.outputFile);
export const renameFile = pify(fs.rename);
export const readFile = pify(fs.readFile);

export const sitemapsUtils = {
    getDeclarations: function () {
        return (
            // eslint-disable-next-line quotes
            '<?xml version="1.0" encoding="UTF-8"?>' +
            // eslint-disable-next-line quotes
            '<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>'
        );
    },
};
