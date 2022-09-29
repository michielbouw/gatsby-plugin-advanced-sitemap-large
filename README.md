# gatsby-plugin-advanced-sitemap

The default Gatsby sitemap plugin generates a simple blob of raw XML for all your pages. This advanced sitemap plugin adds more power and configuration, generating a single or multiple sitemaps with full XSL templates to make them neatly organised and human + machine readable, as well linking image resources to encourage media indexing.

Forked from: https://github.com/TryGhost/gatsby-plugin-advanced-sitemap

Additional features for this package:

-   Allow sending siteUrl in config: `siteUrl: string` OR include `site.siteMetadata.siteUrl` in the custom query
-   Allow adding function as exclusion rule, using the node as value to determine if a url should be excluded or not
-   Allow skip skipping default query in config: `skipDefaultQuery: true|false`
-   Performance improvements for large sites:
    -   force sequential execution for multiple asynchronously queries for each mapping to prevent memory issues by defining the `query` as key|value pairs in an object
    -   [experimental] split execution of single queries into pages with max. items (options: `splitQueryPageSize: 100`) to prevent memory issues (requires defining the `query` as key|value pairs in an object with single queries inside with params `limit: $limit` and `skip: $skip`)

## How to Use

By default this plugin will generate a single sitemap of all pages on your site, without any configuration needed.

```javascript
// gatsby-config.js

siteMetadata: {
    siteUrl: `https://www.example.com`,
},
plugins: [
    `gatsby-plugin-advanced-sitemap`
]
```

&nbsp;

## Options

If you want to generate advanced, individually organised sitemaps based on your data, you can do so by passing in a query and config. The example below uses [Ghost](https://ghost.org/), but this should work with any data source - including Pages, Markdown, Contentful, etc.

**Example:**

```javascript
// gatsby-config.js

plugins: [
    {
        resolve: `gatsby-plugin-advanced-sitemap`,
        options: {
            // optional: siteUrl string
            siteUrl: 'https://example.com',
            // optional: skipDefaultQuery boolean, if skipping define siteUrl OR include `site.siteMetadata.siteUrl` in the custom query
            skipDefaultQuery: true,
            // optional: query for each data type, define as key|value pairs in an object to enable to enable sequential querying
            query: `
            {
                allGhostPost {
                    edges {
                        node {
                            id
                            slug
                            updated_at
                            feature_image
                        }
                    }
                }
                allGhostPage {
                    edges {
                        node {
                            id
                            slug
                            updated_at
                            feature_image
                        }
                    }
                }
            }`,
            // OR {
            //     allGhostPost: `{ // mind that the object keys should be corresponding to the query field name and the mapping key
            //         allGhostPost {
            //             edges {
            //                 node {
            //                     id
            //                     slug
            //                     updated_at
            //                     feature_image
            //                 }
            //             }
            //         }
            //     }`,
            //     allGhostPage: `{
            //         allGhostPage {
            //             edges {
            //                 node {
            //                     id
            //                     slug
            //                     updated_at
            //                     feature_image
            //                 }
            //             }
            //         }
            //     }`,
            // },
            // [experimental] optional: only works if using key|value pairs in an object to enable to enable sequential querying, requires the following syntax in your single queries:
            //   query getContent($limit: Int, $skip: Int) {
            //     allSitePage(
            //       limit: $limit
            //       skip: $skip
            //   ) {
            //     pageInfo {
            //       hasNextPage
            //     }
            //     edges {
            //       node {
            //         ...
            //       }
            //     }
            //   }
            // [experimental] optional: only applies to using the above setup in query with skip and limit
            splitQueryPageSize: 100,
            output: "/custom-sitemap.xml", // optional: the filepath and name to Index Sitemap. Defaults to '/sitemap.xml'.
            mapping: { // optional
                // Each data type can be mapped to a predefined sitemap
                // Routes can be grouped in one of: posts, tags, authors, pages, or a custom name
                // The default sitemap - if none is passed - will be pages
                allGhostPost: {
                    sitemap: `posts`,
                    // Add a query level prefix to slugs, Don't get confused with global path prefix from Gatsby
                    // This will add a prefix to this particular sitemap only
                    prefix: 'your-prefix/',
                    // Custom Serializer
                    serializer: (edges) => {
                        return edges.map(({ node }) => {
                            (...) // Custom logic to change final sitemap.
                        })
                    }
                },
                allGhostPage: {
                    sitemap: `pages`,
                },
            },
            exclude: [ // optional
                `/dev-404-page`,
                `/404`,
                `/404.html`,
                `/offline-plugin-app-shell-fallback`,
                `/my-excluded-page`,
                /(\/)?hash-\S*/, // you can also pass valid RegExp to exclude internal tags for example
                (node) => node.isExcluded, // you can also pass a function that gets the single node as input and returns a boolean to determine if the node should be excluded (true) or not (false)
            ],
            createLinkInHead: true, // optional: create a link in the `<head>` of your site
            addUncaughtPages: true, // optional: will fill up pages that are not caught by queries and mapping and list them under `sitemap-pages.xml`
            additionalSitemaps: [ // optional: add additional sitemaps, which are e. g. generated somewhere else, but need to be indexed for this domain
                {
                    name: `my-other-posts`,
                    url: `/blog/sitemap-posts.xml`,
                },
                {
                    url: `https://example.com/sitemap.xml`,
                },
            ],
        }
    }
]
```

## Develop Plugin

1. Install dependencies

```bash
yarn install
```

2. Build Plugin

```bash
yarn build
```

3. Run Tests

```bash
yarn test
```

## 🎓 Learning Gatsby

If you're looking for more guidance on plugins, how they work, or what their role is in the Gatsby ecosystem, check out some of these resources:

-   The [Creating Plugins](https://www.gatsbyjs.com/docs/creating-plugins/) section of the docs has information on authoring and maintaining plugins yourself.
-   The conceptual guide on [Plugins, Themes, and Starters](https://www.gatsbyjs.com/docs/plugins-themes-and-starters/) compares and contrasts plugins with other pieces of the Gatsby ecosystem. It can also help you [decide what to choose between a plugin, starter, or theme](https://www.gatsbyjs.com/docs/plugins-themes-and-starters/#deciding-which-to-use).
-   The [Gatsby plugin library](https://www.gatsbyjs.com/plugins/) has over 1750 official as well as community developed plugins that can get you up and running faster and borrow ideas from.
