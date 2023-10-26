const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const axios = require('axios');
//const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const fetch = require('node-fetch');

const VERSIONING_STRATEGY = {
  'alphanumeric': incrementPatchVersionAlphabeticSequence,
  'numeric': incrementPatchVersionNumericSequence
};

async function run() {
  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
    // const octokit = new Octokit({ auth: GITHUB_TOKEN, });
    const github = new GitHub(GITHUB_TOKEN);

    // Get owner and repo from context of payload that triggered the action
    const { owner: currentOwner, repo: currentRepo } = context.repo;

    // versioning strategy
    const versioning = core.getInput('versioning', { required: false }) || 'numeric';

    if(versioning !== 'alphanumeric' && versioning !== 'numeric') {
      core.setFailed('versioning must be alphanumeric or numeric.');
    }

    // Get Hotfix tag
    const isHotfix = core.getInput('hotfix', { required: false }) === 'false';
    const currentLatestTag = fetchLatestTag(currentOwner, currentRepo);
    if(currentLatestTag == null) {
      core.setFailed('Could not find any release.');
    }

    // url and credentials for release body (Only jira)
    const bodyApiUrl = core.getInput('body_api_url', {required: false});
    const bodyApiKey = core.getInput('body_api_key', {required: false});
    const projectName = core.getInput('project_name', {required: false});

    const bodyString = (bodyApiUrl !== '' && bodyApiKey !== '') ? fetchRelatedWork(bodyApiUrl, bodyApiKey, projectName) : '';
    
    // Get the inputs from the workflow file: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const tagName = core.getInput('tag_name', { required: true });

    // This removes the 'refs/tags' portion of the string, i.e. from 'refs/tags/v1.10.15' to 'v1.10.15'
    const tag = isHotfix === 'false' ? tagName.replace('refs/tags/', '') : createHotfixTag(currentLatestTag, versioning);
    const releaseName = core.getInput('release_name', { required: false }).replace('refs/tags/', '');
    const body = core.getInput('body', { required: false });
    const draft = core.getInput('draft', { required: false }) === 'true';
    const prerelease = core.getInput('prerelease', { required: false }) === 'true';
    const commitish = core.getInput('commitish', { required: false }) || context.sha;

    const bodyPath = core.getInput('body_path', { required: false }) || bodyString;
    const owner = core.getInput('owner', { required: false }) || currentOwner;
    const repo = core.getInput('repo', { required: false }) || currentRepo;
    let bodyFileContent = null;
    if (bodyPath !== '' && !!bodyPath) {
      try {
        bodyFileContent = fs.readFileSync(bodyPath, { encoding: 'utf8' });
      } catch (error) {
        core.setFailed(error.message);
      }
    }

    // Create a release
    // API Documentation: https://developer.github.com/v3/repos/releases/#create-a-release
    // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-create-release
    const createReleaseResponse = await github.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name: releaseName,
      body: bodyFileContent || body,
      draft,
      prerelease,
      target_commitish: commitish
    });

    // Get the ID, html_url, and upload URL for the created Release from the response
    const {
      data: { id: releaseId, html_url: htmlUrl, upload_url: uploadUrl }
    } = createReleaseResponse;

    // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    core.setOutput('id', releaseId);
    core.setOutput('html_url', htmlUrl);
    core.setOutput('upload_url', uploadUrl);
  } catch (error) {
    core.setFailed(error.message);
  }
}

/**
 * create Hotfix tag from latest tag
 * @param {string} latest_tag MAJOR.MINOR.PATCH like v1.0.0 or v1.0.0a 
 * @param {string} versioning 
 * @returns (string) Semantic version like v1.0.0 or v1.0.0a 
 */
async function createHotfixTag(latest_tag, versioning) {
  const hotfixTag = latest_tag.split('.');
  const hotfixTagLength = hotfixTag.length;
  const newPatchVersion = VERSIONING_STRATEGY[versioning](hotfixTag[hotfixTagLength - 1]);
  hotfixTag[hotfixTagLength - 1] = newPatchVersion;
  
  return hotfixTag.join('.');
}

/**
 * create new Patch version from latest patch version.
 * @param {string} patchVersion
 * @returns ({string, string}) seperated patch version likes {1, a}, {2, bc} ...
 */
function seperatePatchVersion(patchVersion) {
  const numberPart = patchVersion.match(/\d+/);
  const alphaPart = patchVersion.match(/[a-zA-Z]+/);

  const number = numberPart ? numberPart[0] : '';
  const alpha = alphaPart ? alphaPart[0] : 'a';

  return number, alpha;
}

/**
 * increase alphabet sequence.
 * @param {string} patchVersionAlphabet 
 * @returns {string} alphabet sequence like 1a, 15ba, zcx ...
 */
function incrementPatchVersionAlphabeticSequence(patchVersion) {
  const {number, alphabet} = seperatePatchVersion(patchVersion)
  let current = alphabet

  if (current.endsWith('z')) {
    const lastCharIndex = current.length - 1;
    let carry = true;

    for (let i = lastCharIndex; i >= 0 && carry; i--) {
      if (current[i] === 'z') {
        current = current.substring(0, i) + 'a' + current.substring(i + 1);
      } else {
        current = current.substring(0, i) + String.fromCharCode(current.charCodeAt(i) + 1) + current.substring(i + 1);
        carry = false;
      }
    }

    if (carry) {
      current = 'a' + current;
    }
  } else {
    current = current.substring(0, current.length - 1) + String.fromCharCode(current.charCodeAt(current.length - 1) + 1);
  }

  return number + current;
}

/**
 * increase numeric sequence.
 * @param {number} patchVersionNumeric
 * @returns (int) like 1, 2, 15...
 */
function incrementPatchVersionNumericSequence(patchVersionNumber) {
  return patchVersionNumber + 1
}

/**
 * get latest tag in repository.
 * @returns latest tag
 */
async function fetchLatestTag(owner, repo) {
  try {
    const response = await octokit.repos.listTags({
      owner,
      repo,
    });

    if (response.data.length > 0) {
      return response.data[0].name;
    } 
  } catch (error) {
    console.error('Error:', error);
  }

  return null;
}

/**
 * fetch release body.
 * @param {string} url jira api url 'https://your-domain.atlassian.net'
 * @param {string} key jira api key like 'email@example.com:<api_token>'
 * @param {string} project your jira project name like 'TAG'
 * @returns {string} release body from release notes.
 */
function fetchRelatedWork(url, key, project) {
  const versionId = fetchVersionId(url, key);
  
  return fetchIssuesFromVersion(url, key, versionId);
}

/**
 * fetch Jira release version id like 10001
 * @param {string} url jira api url 'https://your-domain.atlassian.net'
 * @param {string} key jira api key like 'email@example.com:<api_token>'
 * @returns {int} Jira release version id like 10001
 */
function fetchVersionId(url, key) {  
  fetch(url + `/rest/api/3/project/${projectIdOrKey}/version`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${Buffer.from(key).toString('base64')}`,
      'Accept': 'application/json'
    }
  })
  .then(response => {
    console.log(
      `Response: ${response.status} ${response.statusText}`
    );
    return response.text();
  })
  .then(text => console.log(text))
  .catch(err => console.error(err));


  // Todo
  return 10019;
}

/**
 * fetch release version contains issues.
 * @param {string} url jira api url 'https://your-domain.atlassian.net'
 * @param {string} key jira api key like 'email@example.com:<api_token>'
 * @param {int} versionId jira release(version) id.
 * @returns {*}
 */
function fetchIssuesFromVersion(url, key, versionId) {
  // Todo
  return {
    version: "v1.0.1",
    issues: [
      {
        title: "a",
        jiraTag: "TAG-1",
        type: "Subtle",
        releaseNote: "note",
      },
      {
        title: "b",
        jiraTag: "TAG-2",
        type: "Subtle",
        releaseNote: "note",
      },
      {
        title: "b",
        jiraTag: "TAG-3",
        type: "버그",
        releaseNote: null,
      },
      {
        title: "b",
        jiraTag: "TAG-4",
        type: "버그",
        releaseNote: null,
      }
    ]
  }
}

module.exports = run;
