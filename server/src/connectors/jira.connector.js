export class JiraConnector {
  get configured() { return Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN); }
  async testConnection() {
    if (!this.configured) return {configured:false,status:'demo',message:'Credentials not set; bundled Jira demo records are active.'};
    const response = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/myself`, {headers:{authorization:`Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,accept:'application/json'}});
    return {configured:true,status:response.ok?'healthy':'error',httpStatus:response.status};
  }
  async fetchIssues({startAt=0,maxResults=50}={}) {
    if (!this.configured) throw new Error('Jira connector is not configured');
    const url = new URL('/rest/api/3/search/jql',process.env.JIRA_BASE_URL); url.searchParams.set('jql','ORDER BY updated DESC'); url.searchParams.set('startAt',startAt); url.searchParams.set('maxResults',Math.min(maxResults,100)); url.searchParams.set('fields','summary,status,assignee,labels,updated,*all');
    const response = await fetch(url,{headers:{authorization:`Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,accept:'application/json'}});
    if (response.status===429) throw Object.assign(new Error('Jira rate limited the sync'),{retryAfter:response.headers.get('retry-after')});
    if (!response.ok) throw new Error(`Jira API ${response.status}`); return response.json();
  }
}
export const jiraConnector = new JiraConnector();
