# issue-to-page
GitHub Action that converts an issue to a markdown page

This action is intended as a helper that bridges between issue forms and github pages.

The action will create a folder inside the `target` folder. This folder has name uses the name of the used issue template and the issue number to securely indicate the issue. if no issue template is provided, then the prefix will be `page`. It will dump the content of a converted issue into the new folder. It will also download all images in the issue into that folder. 

## Inputs

### `label` 

the label to look for.

### `issue_template`

Inform if a template is used. This will then preprocess the issue

### `publish_label` 

pass a secondary tag that needs to be present before publishing.

### `auto_convert` 

allows to select users, who's issues are automatically converted even if the `publish_label` is missing.

### `target` 

points to a repo directory.

### `template` 

allows to set a template for creating the markdown file. 

### `close_issue`

close the issue after conversion. Default is `true`. Set this to `false` or `no` if 
the issue should remain open. 

## Example usage
