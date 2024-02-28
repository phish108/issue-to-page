const core = require('@actions/core');
const github = require('@actions/github');

try {
    const message = "well done";
    
    console.log(`The event payload: ${message}`);
  } catch (error) {
    core.setFailed(error.message);
  }