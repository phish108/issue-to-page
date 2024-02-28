# issue-to-page
GitHub Action that converts an issue to a markdown page

This action is intended as a helper that bridges between issue forms and github pages.

The action will create a folder inside the `target` folder. This folder has name uses the name of the used issue template and the issue number to securely indicate the issue. if no issue template is provided, then the prefix will be `page`. It will dump the content of a converted issue into the new folder. It will also download all images in the issue into that folder. 

## Inputs

### `auto-convert` 

Allows to select users, who's issues are automatically converted even if the `publish_label` is missing. Defaults to the owners of the repo. 

### `close-issue`

Close the issue after conversion. Default is `true`. Set this to `false` or `no` if 
the issue should remain open. 

### `github-token`

The github access token for the action. Defaults to `github.token`. Use your own token if really needed. 

### `issue-template`

Inform if a template is used. This will then preprocess the issue. If no template is provided, then the issue will be just dumped as plain markdown.

### `label` 

The label to look for. If omitted, then the all issues are converted.

### `publish-label` 

Pass a secondary tag that needs to be present before publishing. If the secondary label is missing, then the issue will not get converted.

### `target-folder` 

Points to the repo directory where the issues are converted into.

### `template` 

Allows to set a template for creating the markdown file. This is used to validated the fields of the issue.

## Example usage
