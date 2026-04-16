export default {
  providers: [
    {
      // CONVEX_SITE_URL is automatically set by Convex (e.g. https://your-project.convex.site)
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
