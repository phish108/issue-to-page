const core = require('@actions/core');
const github = require('@actions/github');

try {
    const message = "well done";

    // check and default inputs
    // load the issue template fields 
    // load the issue 
    // validate the issue template fields
    // create the target folder 
    // download all attachments and keep the content type
    // replace all links to point to the correct location of the attachments
    // create the index.md file with the issue content

    console.log(`The event payload: ${message}`);
} catch (error) {
    core.setFailed(error.message);
}

