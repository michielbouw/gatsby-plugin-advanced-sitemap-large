import path from "path";
import uniqBy from "lodash/uniqBy";
import merge from "lodash/merge";

import defaultOptions, {
    DEFAULTMAPPING,
    DEFAULTQUERY,
    PUBLICPATH,
    RESOURCESFILE,
    XSLFILE,
} from "./defaults";
import Manager from "./SiteMapManager";

import * as utils from "./utils";
import {
    addPageNodes,
    serializeMarkdownNodes,
    serializeSources,
} from "./serializers";
import { getNodePath } from "./helpers";

let siteURL;

const copyStylesheet = async ({ siteUrl, pathPrefix, indexOutput }) => {
    const siteRegex = /(\{\{blog-url\}\})/g;

    // Get our stylesheet template
    const data = await utils.readFile(XSLFILE);

    // Replace the `{{blog-url}}` variable with our real site URL
    const sitemapStylesheet = data
        .toString()
        .replace(
            siteRegex,
            new URL(path.join(pathPrefix, indexOutput), siteUrl).toString()
        );

    // Save the updated stylesheet to the public folder, so it will be
    // available for the xml sitemap files
    await utils.writeFile(
        path.join(PUBLICPATH, "sitemap.xsl"),
        sitemapStylesheet
    );
};

/**
 * [experimental] Performance improvements for large sites:
 * - split execution of single queries into pages with max. items to prevent memory issues (requires defining the `query` as key|value pairs in an object)
 */
const splitQueryInSmallerBatches = async (
    handler,
    activity,
    { queryKey, queryString },
    splitQueryPageSize = 100
) => {
    activity.setStatus("[experimental] run queries in smaller batches");

    try {
        const itemsPerPage = splitQueryPageSize;
        let currentPage = 0;

        const fetchPages = async (
            params = { limit: itemsPerPage, skip: 0 }
        ) => {
            const queryParams = params;

            activity.setStatus(
                `[experimental] run query "${queryKey}" batch #${
                    currentPage + 1
                }`
            );

            const tempData = await handler(queryString, queryParams).then(
                (r) => r.data?.[queryKey]
            );

            if (tempData?.pageInfo?.hasNextPage) {
                currentPage = currentPage + 1;
                const tempDataMore = await fetchPages({
                    ...queryParams,
                    skip: currentPage * itemsPerPage,
                });
                if (
                    tempData?.edges &&
                    tempData.edges.length &&
                    tempDataMore?.edges &&
                    tempDataMore.edges.length
                ) {
                    tempData.edges = tempData.edges.concat(tempDataMore.edges);
                }
            }

            return tempData;
        };

        return await fetchPages();
    } catch (_e) {
        activity.setStatus(
            "[experimental] failed running queries in smaller batches, trying without batching"
        );
        // Fallback to general function from `runQueriesSequentially`
        return await handler(queryString).then((r) => r.data?.[queryKey]);
    }
};

/**
 * Performance improvements for large sites:
 * - force sequential execution for multiple asynchronously queries for each mapping to prevent memory issues by defining the `query` as key|value pairs in an object
 */
const runQueriesSequentially = async (
    handler,
    activity,
    queryObject,
    splitQueryPageSize
) => {
    activity.setStatus("run queries sequentially");

    try {
        const queries = Object.entries(queryObject).map(
            ([queryKey, queryString]) => {
                return { queryKey, queryString };
            }
        );
        const responsesObject = {};

        // sequential execution for multiple asynchronously queries for each mapping to prevent memory issues
        for (const item of queries) {
            activity.setStatus(`start run query "${item.queryKey}"`);

            if (
                // Only continue with query splitting if `hasNextPage` key AND `$limit:` + `$skip:` parameter initialisation and useage is present in the querystring
                item.queryString.indexOf("hasNextPage") > -1 &&
                item.queryString.indexOf("$limit:") > -1 &&
                item.queryString.indexOf("$skip:") > -1 &&
                item.queryString.indexOf("limit: $limit") > -1 &&
                item.queryString.indexOf("skip: $skip") > -1
            ) {
                responsesObject[item.queryKey] =
                    await splitQueryInSmallerBatches(
                        handler,
                        activity,
                        item,
                        splitQueryPageSize
                    );
            } else {
                responsesObject[item.queryKey] = await handler(
                    item.queryString
                ).then((r) => r.data?.[item.queryKey]);
            }

            // wait 1 second before next call to prevent memory overload
            await new Promise((r) => setTimeout(r, 1000));
        }

        return responsesObject;
    } catch (error) {
        throw new Error(error);
    }
};

const runQuery = async (
    handler,
    activity,
    { query, mapping, exclude, splitQueryPageSize }
) => {
    let sources;
    if (typeof query === "object") {
        sources = await runQueriesSequentially(
            handler,
            activity,
            query,
            splitQueryPageSize
        );
    } else {
        sources = await handler(query).then((r) => r.data);
    }

    Object.keys(sources).forEach((sourceKey) => {
        // Check for custom serializer
        if (typeof mapping?.[sourceKey]?.serializer === "function") {
            if (sources[sourceKey] && Array.isArray(sources[sourceKey].edges)) {
                const serializedEdges = mapping[sourceKey].serializer(
                    sources[sourceKey].edges
                );

                if (!Array.isArray(serializedEdges)) {
                    throw new Error(
                        "Custom sitemap serializer must return an array"
                    );
                }
                sources[sourceKey].edges = serializedEdges;
            }
        }

        // Removing excluded paths
        if (sources[sourceKey]?.edges && sources[sourceKey].edges.length) {
            sources[sourceKey].edges = sources[sourceKey].edges.filter(
                ({ node }) =>
                    !exclude.some((excludedRoute) => {
                        const sourceType = node.__typename
                            ? `all${node.__typename}`
                            : sourceKey;
                        const slug =
                            sourceType === "allMarkdownRemark" ||
                            sourceType === "allMdx" ||
                            node?.fields?.slug
                                ? node.fields.slug.replace(/^\/|\/$/, "")
                                : node.slug.replace(/^\/|\/$/, "");

                        excludedRoute =
                            typeof excludedRoute === "function" ||
                            typeof excludedRoute === "object"
                                ? excludedRoute
                                : excludedRoute.replace(/^\/|\/$/, "");

                        if (typeof excludedRoute === "function") {
                            // test if the passed excludedRoute is a function
                            const isNodeExcluded = excludedRoute(node);
                            return isNodeExcluded;
                        } else if (typeof excludedRoute === "object") {
                            // test if the passed excludedRoute is a regular expression
                            let excludedRouteIsValidRegEx = true;
                            try {
                                new RegExp(excludedRoute);
                            } catch (e) {
                                excludedRouteIsValidRegEx = false;
                            }

                            if (!excludedRouteIsValidRegEx) {
                                throw new Error(
                                    "Excluded route is not a valid RegExp: ",
                                    excludedRoute
                                );
                            }

                            return excludedRoute.test(slug);
                        } else {
                            return slug.indexOf(excludedRoute) >= 0;
                        }
                    })
            );
        }
    });

    return sources;
};

const serialize = (
    { ...sources } = {},
    defaultQueryRecords,
    {
        mapping,
        addUncaughtPages,
        query,
        siteUrl: overrideSiteUrl,
        skipDefaultQuery,
    },
    manager
) => {
    const nodes = [];
    const sourceObject = {};

    const { site, allSitePage } =
        skipDefaultQuery && query
            ? { site: undefined, allSitePage: undefined }
            : defaultQueryRecords;

    let allSitePagePathNodeMap;
    if (!(skipDefaultQuery && query) && allSitePage?.edges) {
        allSitePagePathNodeMap = new Map();
        allSitePage.edges.forEach((page) => {
            if (page?.node?.url) {
                const pathurl = page.node.url.replace(/\/$/, "");
                allSitePagePathNodeMap.set(pathurl, pathurl);
            }
        });
    }

    siteURL = overrideSiteUrl ?? site?.siteMetadata.siteUrl;
    if (!siteURL) {
        throw new Error(
            "Missing siteUrl, you most likely forgot to set siteUrl in config when skipping defaultQuery"
        );
    }

    for (let type in sources) {
        if (mapping?.[type]?.sitemap) {
            const currentSource = sources[type] ? sources[type] : [];

            if (currentSource?.edges) {
                const sitemapType = mapping[type].sitemap;
                sourceObject[sitemapType] = sourceObject[sitemapType] || [];
                currentSource.edges.map(({ node }) => {
                    if (!node) {
                        return;
                    }
                    const nodeType = node.__typename
                        ? `all${node.__typename}`
                        : type;
                    if (
                        nodeType === "allMarkdownRemark" ||
                        nodeType === "allMdx"
                    ) {
                        node = serializeMarkdownNodes(node);
                    }

                    // if a mapping path is set, e. g. `/blog/tag` for tags, update the path
                    // to reflect this. This prevents mapping issues, when we later update
                    // the path with the Gatsby generated one in `getNodePath`
                    if (mapping[type].path) {
                        node.path = path.resolve(mapping[type].path, node.slug);
                    } else {
                        node.path = node.slug;
                    }

                    if (
                        typeof mapping[type].prefix === "string" &&
                        mapping[type].prefix !== ""
                    ) {
                        node.path = mapping[type].prefix + node.path;
                    }

                    // get the real path for the node, which is generated by Gatsby
                    if (allSitePagePathNodeMap) {
                        node = getNodePath(node, allSitePagePathNodeMap);
                    }

                    const source = {
                        url: new URL(node.path, siteURL).toString(),
                        node,
                    };
                    sourceObject[sitemapType].push(source);
                    // "feed" the sitemaps manager with our records
                    manager.addUrls(sitemapType, source);
                });
            }
        }
    }

    nodes.push(sourceObject);

    // Get all additionally created page URLs that have been generated by Gatsby
    if (allSitePage?.edges && addUncaughtPages) {
        const pageNodes = addPageNodes(nodes, allSitePage.edges, siteURL);
        if (pageNodes[0].pages && pageNodes[0].pages.length > 0) {
            if (nodes[0].pages) {
                nodes[0].pages = nodes[0].pages.concat(pageNodes[0].pages);
            } else {
                nodes[0].pages = pageNodes[0].pages;
            }
        }
    }

    // serialize pages records
    if (nodes[0].pages) {
        nodes[0].pages = uniqBy(nodes[0].pages, "url");

        nodes[0].pages.forEach((node) => {
            // "feed" the sitemaps manager with our serialized records
            manager.addUrls("pages", node);
        });
    }

    return nodes;
};

exports.onPostBuild = async (
    { graphql, reporter, pathPrefix },
    pluginOptions
) => {
    reporter.info("Generating sitemap");

    const activity = reporter.activityTimer("Generating sitemap");
    activity.start();

    let queryRecords;

    // Passing the config option addUncaughtPages will add all pages which are not covered by passed mappings
    // to the default `pages` sitemap. Otherwise they will be ignored.
    const options = pluginOptions.addUncaughtPages
        ? merge(defaultOptions, pluginOptions)
        : Object.assign({}, defaultOptions, pluginOptions);

    const indexSitemapFile = path.join(PUBLICPATH, pathPrefix, options.output);
    const resourcesSitemapFile = path.join(
        PUBLICPATH,
        pathPrefix,
        RESOURCESFILE
    );

    delete options.plugins;
    delete options.createLinkInHead;

    options.indexOutput = options.output;
    options.resourcesOutput = RESOURCESFILE;

    activity.setStatus("querying pages");

    // We need to make sure we don't query too much by listening to options `defaultQueryRecords` but options `query` needs to be present
    let defaultQueryRecords;
    if (!(options.skipDefaultQuery && options.query)) {
        activity.setStatus("run default query");

        try {
            defaultQueryRecords = await runQuery(graphql, activity, {
                query: DEFAULTQUERY,
                exclude: options.exclude,
            });
        } catch (err) {
            throw new Error(
                `Something went wrong running default query: ${err}`
            );
        }
    }

    // Don't run this query when no query and mapping is passed
    if (!options.query || !options.mapping) {
        options.mapping = options.mapping || DEFAULTMAPPING;
    } else {
        activity.setStatus("run custom query");

        try {
            queryRecords = await runQuery(graphql, activity, options);
        } catch (err) {
            throw new Error(
                `Something went wrong running custom query: ${err}`
            );
        }
    }

    // Instanciate the Ghost Sitemaps Manager
    const manager = new Manager(options);

    activity.setStatus("serializing data");

    serialize(queryRecords, defaultQueryRecords, options, manager);

    // The siteUrl is only available after we have the returned query results
    options.siteUrl = siteURL;
    options.pathPrefix = pathPrefix;

    await copyStylesheet(options);

    const resourcesSiteMapsArray = [];

    // Because it's possible to map duplicate names and/or sources to different
    // sources, we need to serialize it in a way that we know which source names
    // we need and which types they are assigned to, independently from where they
    // come from
    options.sources = serializeSources(options);

    activity.setStatus("create sitemap file(s)");

    options.sources.forEach((type) => {
        if (!type.url) {
            // for each passed name we want to receive the related source type
            resourcesSiteMapsArray.push({
                type: type.name,
                xml: manager.getSiteMapXml(type.sitemap, options),
            });
        }
    });

    const indexSiteMap = manager.getIndexXml(options);

    // Save the generated xml files in the public folder
    try {
        await utils.outputFile(indexSitemapFile, indexSiteMap);
    } catch (err) {
        console.error(err);
    }

    for (let sitemap of resourcesSiteMapsArray) {
        const filePath = resourcesSitemapFile.replace(
            /:resource/,
            sitemap.type
        );

        // Save the generated xml files in the public folder
        try {
            await utils.outputFile(filePath, sitemap.xml);
        } catch (err) {
            console.error(err);
        }
    }

    activity.end();

    return;
};
