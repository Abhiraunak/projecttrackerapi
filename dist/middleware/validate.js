// Schema shape: z.object({ body?, query?, params? })
export const validate = (schema) => (req, _res, next) => {
    const parsed = schema.parse({ body: req.body, query: req.query, params: req.params });
    if (parsed.body !== undefined)
        req.body = parsed.body; // req.query is read-only in Express 5
    next();
};
//# sourceMappingURL=validate.js.map