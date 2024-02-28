const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("node:fs").promises;
const path = require("node:path");

const NJK = require("nunjucks");

async function run() {
    try {
        const message = "well done";

        // check and default inputs
        // const auto_convert = core.getInput("auto-convert");
        const close_issue = core.getInput("close-issue") || "";
        const gh_token = core.getInput("github-token");
        const issue_template = core.getInput("issue-template");
        const label = core.getInput("label");
        const publish_label = core.getInput("publish-label");
        const target_folder = core.getInput("target-folder");
        const template = core.getInput("template");

        const octokit = github.getOctokit(gh_token);

        const bool_close = close_issue === "true" || close_issue === "yes" || close_issue === "1";

        const labels = label?.split(",").map(l => l.trim()).filter(l => l.length);

        // load the issue
        const query_issue = `
        query( $owner: String!, $repo: String! ${ labels ? ", $labels: [String!]" : "" }) {
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

        const query_issue_variables = {
            "owner": github.context.repo.owner,
            "repo": github.context.repo.repo
        };

        if (labels) {
            query_issue_variables.labels = labels;
        }

        // load the issue template fields

        const issue_result = await octokit.graphql(query_issue, query_issue_variables);

        const issues = issue_result.repository.issues.nodes;

        if (issues.length > 0) {
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

                if (issue_template) {
                    // validate the issue template fields
                    core.debug("validate against issue template fields");
                }

                // create the issue's target folder
                core.debug("create parent directory for the issue's content");
                await fs.mkdir(path.join(target_folder, `${issue_template || "page"}_${issue.id}`), {recursive: true});

                // download all attachments and keep the content type
                // replace all links to point to the correct location of the attachments

                // NOTE: During development attachments remain at github
                // However, for production we need the files so renderers can access them

                const [date, time] = issue.lastEditedAt?.split("T") || issue.createdAt.split("T");
                const title = issue.title;
                const author = issue.author.login;

                const body = issue.body;

                // ignore issues without body
                if (!(body && body.length)) {
                    core.debug("issue has no body, do not publish.");
                    continue;
                }

                core.debug("render the markdown");

                const context = {
                    title,
                    body,
                    date,
                    time,
                    author
                };
                let page_content = "";

                if (template) {
                    page_content = NJK.render(template, context);
                }
                else {
                    page_content = NJK.renderString("# {{ title }}\n{{ body | safe }}\n", context);
                }

                // create the index.md file with the issue content
                core.debug("write the issue as a markdown page");

                await fs.writeFile(
                    path.join(target_folder, `${issue_template || "page"}_${issue.id}`, "index.md"),
                    page_content
                );

                if (bool_close) {
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
            }
        }

        core.info(`The event payload: ${message}`);
    }
    catch (error) {
        core.setFailed(error.message);
    }
}

run();
