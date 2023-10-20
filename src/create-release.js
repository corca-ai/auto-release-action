const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const fs = require('fs');

async function run() {
  try {
    // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
    const github = new GitHub(process.env.GITHUB_TOKEN);

    // Get owner and repo from context of payload that triggered the action
    const { owner: currentOwner, repo: currentRepo } = context.repo;

    // Get Hotfix tag
    const isHotfix = core.getInput('hotfix', { required: false }) === false;
    const currentLatestTag = core.getInput('latest_tag', { required: false });

    // Get the inputs from the workflow file: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const tagName = core.getInput('tag_name', { required: true });

    // This removes the 'refs/tags' portion of the string, i.e. from 'refs/tags/v1.10.15' to 'v1.10.15'
    const tag = isHotfix ? createHotfixTag(currentLatestTag) : tagName.replace('refs/tags/', '');
    const releaseName = core.getInput('release_name', { required: false }).replace('refs/tags/', '');
    const body = core.getInput('body', { required: false });
    const draft = core.getInput('draft', { required: false }) === 'true';
    const prerelease = core.getInput('prerelease', { required: false }) === 'true';
    const commitish = core.getInput('commitish', { required: false }) || context.sha;

    const bodyPath = core.getInput('body_path', { required: false });
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
 * @returns 
 */
async function createHotfixTag(latest_tag) {

  const hotfixTag = latest_tag.split('.');
  const hotfixTagLength = hotfixTag.length;

  const newPatchVersion = await updatePatchVersion(hotfixTag[hotfixTagLength - 1]);

  hotfixTag[hotfixTagLength - 1] = newPatchVersion;
  const hotfixTagString = hotfixTag.join('.');

  
  return hotfixTagString;
}

/**
 * create new Patch version from latest patch version
 * @param {string} patchVersion
 * @returns 
 */
function updatePatchVersion(patchVersion) {
  const numberPart = patchVersion.match(/\d+/);
  const alphaPart = patchVersion.match(/[a-zA-Z]+/);

  const number = numberPart ? numberPart[0] : '';
  const alpha = alphaPart ? incrementAlphabeticSequence(alphaPart[0]) : 'a';

  return number + alpha;
}

function incrementAlphabeticSequence(patchVersionAlphabet) {
  let current = patchVersionAlphabet;

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

  return current;
}


module.exports = run;
