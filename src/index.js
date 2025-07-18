const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("node:fs").promises;
const path = require("node:path");

const NJK = require("nunjucks");
const YAML = require("yaml");

async function run() {
    const message = "well done";

    // check and default inputs
    // const auto_convert = core.getInput("auto-convert");
    const close_issue = core.getInput("close-issue") || "";
    const gh_token = core.getInput("github-token");
    const label = core.getInput("label");
    const publish_label = core.getInput("publish-label");
    const target_folder = core.getInput("target-folder");
    const template = core.getInput("template");
    const formhints = core.getInput("formhints");

    const octokit = github.getOctokit(gh_token);

    const bool_close = close_issue.toLowerCase() === "true" || close_issue.toLowerCase() === "yes" || close_issue === "1";

    const labels = label?.split(",").map(l => l.trim()).filter(l => l.length);

    // load the issue
    const issues = await loadIssues(octokit, labels);

    core.debug(`got issues? ${issues && issues.length > 0}`);

    if (issues && issues.length > 0) {
        // load the issue template fields

        let hintFields;

        if (formhints) {
            core.debug(`load form hints from ${formhints} file`);
            const formfile = await fs.readFile(formhints);

            hintFields = YAML.parse(formfile.toString());
            core.debug(hintFields);
        }

        // handle one issue at the time!
        for (const issue of issues) {
            // check if the issue is ready for publishing
            const labeled_publishing = issue.labels?.nodes?.filter(l => l.name === publish_label).length;
            const user_publishing = false;

            core.debug(`issue is ${JSON.stringify(issue, null, 2)}`);
            core.debug(`issue ${issue.number} is ready for publishing: ${labeled_publishing} based on ${publish_label}`);
            core.debug(`issue labels are ${issue.labels.nodes.map(l => l.name).join( ", " )}`);

            if (!labeled_publishing && !user_publishing) {
                core.info("issue is not ready for publishing");
                continue;
            }

            // ignore issues without body
            if (!(issue.body && issue.body.length)) {
                core.debug("issue has no body, do not publish.");
                continue;
            }

            // create the issue's target folder
            core.debug("create parent directory for the issue's content");
            await fs.mkdir(path.join(target_folder, `${hintFields.name || "page"}_${issue.number}`), {recursive: true});

            // download all attachments and keep the content type
            // replace all links to point to the correct location of the attachments

            const targetPath = path.join(
                target_folder,
                `${hintFields.name || "page"}_${issue.number}`
            );

            const body = await loadAttachments(issue.body, targetPath);

            core.debug(`loaded attachments: ${body}`);

            // NOTE: During development attachments remain at github
            // However, for production we need the files so renderers can access them

            // const [date, time] = issue.lastEditedAt?.split("T") || issue.createdAt.split("T");
            const [date, time] = issue.createdAt.split("T");
            const title = protectYAMLstrings(issue.title.replace(hintFields?.prefix || "", "").trim());
            const author = issue.author.login;

            core.debug("render the markdown");

            if (!body?.length) {
                core.debug("issue has no body, do not publish.");
                continue;
            }

            const bodyLabels = mapBodyLabels(body, hintFields.body);

            core.debug(`body labels are ${bodyLabels}`);

            const context = {
                title,
                date,
                time,
                author,
                ... bodyLabels,
                ... hintFields?.extra
            };

            core.debug(`context is ${JSON.stringify(context)}`);

            if (!("body" in context && context.body.length)) {
                core.debug("issue context has no body, do not publish.");
                continue;
            }

            await renderToFile(
                template,
                context,
                path.join(
                    targetPath,
                    "index.md"
                )
            );

            if (bool_close) {
                await closeIssue(issue, octokit);
            }
        }
    }

    core.info(`The event payload: ${message}`);
}

async function renderToFile(template, context, targetFile) {
    let page_content = "";

    core.debug(`render the issue to ${targetFile}`);

    if (template) {
        page_content = NJK.render(template, context);
    }
    else {
        page_content = NJK.renderString("# {{ title }}\n{{ body | safe }}\n", context);
    }

    // create the index.md file with the issue content
    core.debug("write the issue as a markdown page");

    await fs.writeFile(targetFile, page_content);
}

async function closeIssue(issue, octokit) {
    core.debug("close the issue");
    const close_issue_query = `mutation($issueId: ID!) {
        data: updateIssue(input: {id : $issueId, state: CLOSED}){
          issue {
            id
            number
            state
          }
      }
    }`;

    const ci_variables = {
        issueId: issue.id
    };

    // inform GH to close the issue
    const result = await octokit.graphql(close_issue_query, ci_variables);

    core.info(`issue ${issue.id} has resulted in ${JSON.stringify(result, null, 2)}`);

    if (result.data.issue.id === issue.id &&
        result.data.issue.state === "CLOSED") {
        core.info(`Issue ${issue.number} has been closed`);
    }
}

function splitBody(body) {
    core.debug(`split body into form fields for ${body}`);

    const fields = body.split(/(### [^\n]+)/);

    core.debug("split body into form fields");

    if (!fields || fields.length === 1) {
        return {body};
    }

    if (fields[0].length === 0) {
        fields.shift();
    }

    // this reduction only works because the split function will return an array
    // with alternating elements of the split and the delimiter
    return Object.fromEntries(
        fields.reduce((acc, field) => {
            if (field.match(/### [^\n]+/) !== null) {
                acc.push([field.replace("### ", "").trim()]);
            }
            // this condtion ensures that leading texts are igored
            else if (acc.length > 0){
                acc[acc.length - 1].push(field.trim());
            }
            return acc;
        }, [])
    );
}

function protectYAMLstrings(value) {
    // protect YAML strings that start with a dash
    // so they are not interpreted as YAML
    if (
        typeof value === "string"
    ) {
        if (value === "-" || value === ":") {
            // stringify ignores single dash and colon :(
            return `"${value}"`;
        }

        // if a string is protected then it must not contain newlines
        return YAML.stringify(value).replace(/\n/g, " ");
    }
    return value;
}

function hintHandler(bodyHints) {
    const regexImage = /!\[([^\]]+)\]\(([^)]+)\)/g;
    const regexFile = /\[([^\]]+)\]\(([^)]+)\)/g; // including images
    const regexOptions = /- \[([X\s]?)\] ([^\n]+)/g; // load checkbox list

    const regexFixHeader = /^\s*###/g; // drop leading ## to raise the header level

    return function handleHintType([key, value]) {
        const keylist = bodyHints.filter(hint => hint.label === key);

        if (keylist.length === 0) {
            core.debug(`no hint for ${key}`);
            return null;
        }

        const newkey = keylist.shift();

        core.debug(`hint for ${key} is ${newkey}`);

        if (!("id" in newkey)) {
            core.debug(`no id for ${newkey} (${key})`);
            return null;
        }

        value = value.trim();

        if (value === "_No response_") {
            core.debug(`no response for ${newkey.id}`);
            return null;
        }

        if (!("type" in newkey)) {
            newkey.type = "text";
        }

        core.debug(`remap field as ${newkey.type}`);

        let date, time;

        switch (newkey.type) {
                case "list":
                    value = value.split("- ").map(v => v.trim()).filter(v => v.length).map(protectYAMLstrings);
                    break;
                case "image":
                    value = [...value.matchAll(regexImage)].map(([_, name, url]) => ({name, url})).shift(); // eslint-disable-line no-unused-vars
                    break;
                case "[image]":
                    value = [...value.matchAll(regexImage)].map(([_, name, url]) => ({name, url})); // eslint-disable-line no-unused-vars
                    break;
                case "file":
                    value = [...value.matchAll(regexFile)].map(([_, name, url]) => ({name, url})).shift(); // eslint-disable-line no-unused-vars
                    break;
                case "[file]":
                    value = [...value.matchAll(regexFile)].map(([_, name, url]) => ({name, url})); // eslint-disable-line no-unused-vars
                    break;
                case "flag":
                    value = [...value.matchAll(regexOptions)].map(([_, flag, name]) => ({flag, name})).shift(); // eslint-disable-line no-unused-vars
                    break;
                case "[flag]":
                    value = [...value.matchAll(regexOptions)].map(([_, flag, name]) => ({flag, name})); // eslint-disable-line no-unused-vars
                    break;
                case "date":
                    [date, time] = value.split(/[T\s]/);
                    value = {date, time};
                    break;
                case "table":
                    value = tableToObject(value);
                    break;
                default:
                    break;
        }

        if (newkey.type === "text" && newkey?.fix_heading) {
            // ensure that we don't accidentally drop a header
            value = value.replace(regexFixHeader, "#");

        }

        if (newkey.indent > 0) {
            const indent = " ".repeat(newkey.indent);

            value = value.replace(/\n/g, `\n${indent}`);
        }

        if (newkey.id !== "body" && newkey.type === "text" && !(newkey.indent > 0) ) {
            value = protectYAMLstrings(value);
        }

        core.debug(`remapped field ${newkey.id} to ${value}`);
        return [newkey.id, value];
    };
}

function tableToObject(tablestring) {
    // split the table into rows
    // strip the leading and the trailing pipes
    // split all rows row into columns and
    // strip the leading and the trailing spaces
    const rows = tablestring.split("\n").map(
        r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => protectYAMLstrings(c.trim()))
    );

    // the first row is the header with the field names
    const headers = rows.shift();

    rows.shift(); // remove the separator

    return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function dropEmpty(f) {
    return f !== null;
}

function mapBodyLabels(body, bodyHints) {
    if(!bodyHints) {
        core.debug("no hints for body");
        return {body};
    }

    core.debug(`map body to form hints ${bodyHints}`);

    const bodyFields = splitBody(body);

    if (bodyFields.length === 0) {
        core.debug("no fields found in body");
        return {body};
    }

    const fields = Object.entries(bodyFields)
        .map(hintHandler(bodyHints))
        .filter(dropEmpty);

    if (fields.length === 0) {
        core.debug("no valid fields found in body");
        return null;
    }

    core.info(`mapped fields ${JSON.stringify(Object.fromEntries(fields))}`);

    return Object.fromEntries(fields);
}

async function loadAttachments(body, targetDir) {
    const {owner, repo} = github.context.repo;

    core.debug(`load attachments for ${owner}/${repo} and ${targetDir}`);

    if (!targetDir) {
        targetDir = "";
    }

    // we can only handle attaches to issues,
    // everything else is treated as regular links
    const regex = new RegExp(`https://github\\.com/user-attachments/assets/`);
    const regexOld = new RegExp(`https://github\\.com/${owner}/${repo}/assets/`);

    core.debug(`attachment regex is ${regex}`);

    // get all attachment references
    const tAtt = [...body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
        .map(([_, name, url]) => ({name, url})); // eslint-disable-line no-unused-vars

    const attachments = tAtt.filter(u => u.url.match(regex)).concat(tAtt.filter(u => u.url.match(regexOld)));

    // core.debug(`attachments are ${JSON.stringify(attachments)}`);

    if (attachments) {
        // handle one file at the time to catch errors
        // note that the for loop handles the empty list correctly

        for (const attachment of attachments) {
            core.debug(`download attachment ${attachment.name}`);

            // download all attachments and keep the content type
            try {
                const respose = await fetch(attachment.url);
                const blob = await respose.blob();

                const type = blob.type.replace(/[^/]+\//, "").replace(/\+.+/, ""); // keep only the suffix
                const fullFilename = `${attachment.name.replace(/[\s()%?'"`^=@]+/g, "_")}.${type}`;
                const fspath = path.join(targetDir, fullFilename);

                await fs.writeFile(fspath, blob.stream());

                // replace all links to point to the correct location of the attachment
                body = body.replace(attachment.url, fullFilename);
            }
            catch (error) {
                core.debug(`error downloading attachment ${attachment.url}: ${error.message}`);
                // keep going
            }
        }
    }

    core.debug(`loaded attachments for: ${body}`);

    return body;
}

async function loadIssues(octokit, labels) {
    const query_issue =
    `query( $owner: String!, $repo: String! ${ labels ? ", $labels: [String!]" : "" }) {
        repository(owner: $owner, name: $repo) {
          name
          
          issues(states: [OPEN], first:100 ${ labels ? ", labels: $labels" : "" }) {
                nodes {
                author {
                    login 
                }
                id
                number
                title
                createdAt
                lastEditedAt
                body
                bodyResourcePath
                labels(first:10) {
                  nodes {
                    name
                  }
                }
              }
          }
        }
    }`;

    const {owner, repo} = github.context.repo;

    core.debug(`load issues for ${owner}/${repo} and ${labels}`);
    core.debug(`query is ${query_issue}`);

    const issue_result = await octokit.graphql(query_issue, labels ? {owner, repo, labels} : {owner, repo});

    core.debug(issue_result);

    return issue_result?.repository?.issues?.nodes;
}

async function main() {

    try {
        await run();
    }
    catch (error) {
        core.setFailed(error.message);
    }
}

// execute the action
main();
