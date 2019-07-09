const vscode = require('vscode')
const querystring = require('querystring')
const rgPath = require('vscode-ripgrep').rgPath
const {
  execSync
} = require('child_process')

const rootPath = vscode.workspace.rootPath
const MAX_DISPLAY_LINE_LENGTH = 128

const execOpts = {
  cwd: rootPath,
  maxBuffer: 1024 * 1000
}

function processCommand(cmd) {
  return cmd.replace(/"/g, "\\\"").replace(/\s/g, ".*?")
}

function trimResult(text, foundPosition, cmd) {
  const padding = MAX_DISPLAY_LINE_LENGTH / 8
  const padBack = foundPosition - padding
  const padForw = foundPosition + cmd.length + padding
  const start = padBack < 0 ? 0 : padBack
  const end = padForw > text.length ? text.length : padForw
  return text.substr(start, end)
}

class SearchyProvider {
  constructor() {
    this.links = []
    this._subscriptions = vscode.workspace.onDidCloseTextDocument(doc => {
      this.links[doc.uri.toString()] = []
    })
  }

  dispose() {
    this._subscriptions.dispose()
  }

  static get scheme() {
    return 'searchy'
  }

  onDidChange() {}

  provideTextDocumentContent(uri) {
    let uriString = uri.toString()
    this.links[uriString] = []
    const params = querystring.parse(uri.query)
    const cmd = params.cmd

    let searchResults = null
    try {
      searchResults = runCommandSync(cmd)
    } catch (err) {
      return `${err}`
    }

    if (searchResults == null || !searchResults.length) {
      return 'There was an error during your search!'
    }

    let resultsArray = searchResults.toString().split('\n')
    resultsArray = resultsArray.filter((item) => {
      return item != null && item.length > 0
    })
    let resultsByFile = {}

    resultsArray.forEach((searchResult) => {
      let splitLine = searchResult.split(/([^:]+):([^:]+):([^:]+):(.+)/)
      let fileName = splitLine[1]
      if (fileName == null || !fileName.length) {
        return
      }
      if (resultsByFile[fileName] == null) {
        resultsByFile[fileName] = []
      }
      const formattedLine = formatLine(splitLine)
      resultsByFile[fileName].push(formattedLine)
    })

    let sortedFiles = Object.keys(resultsByFile).sort()
    let lineNumber = 1

    let lines = sortedFiles.map((fileName) => {
      lineNumber += 1
      let resultsForFile = resultsByFile[fileName].map((searchResult, index) => {
        lineNumber += 1
        const text = searchResult.result;
        const foundPosition = text.search(new RegExp(processCommand(cmd)))
        searchResult.result = text.length <= MAX_DISPLAY_LINE_LENGTH
          ? text : trimResult(text, foundPosition, cmd)
        this.createDocumentLink(searchResult, lineNumber, cmd, uriString)
        return `  ${searchResult.line}: ${searchResult.result}`
      }).join('\n')
      lineNumber += 1
      return `
file://${rootPath}/${fileName}
${resultsForFile}`
    })
    let header = [`${resultsArray.length} search results found for "${cmd}"`]
    let content = header.concat(lines)

    return content.join('\n')
  }

  provideDocumentLinks(document) {
    return this.links[document.uri.toString()]
  }

  createDocumentLink(formattedLine, lineNumber, cmd, docURI) {
    const {
      file,
      line,
      column
    } = formattedLine
    const col = parseInt(column, 10)
    const preamble = `  ${line}:`.length
    let cmdRegEx = new RegExp(processCommand(cmd))
    const match = formattedLine.result.match(cmdRegEx)
    const search = formattedLine.result.search(cmdRegEx)
    const uri = vscode.Uri.parse(`file://${rootPath}/${file}#${line}`)
    if (search !== -1) {
      const searchTerm = match[0].length
      this.links[docURI].push(new vscode.DocumentLink(new vscode.Range(
        lineNumber,
        preamble + search + 1,
        lineNumber,
        preamble + search + 1 + searchTerm
      ), uri))
    }
    this.links[docURI].push(new vscode.DocumentLink(new vscode.Range(
      lineNumber,
      2,
      lineNumber,
      preamble
    ), uri))
  }
}

module.exports = SearchyProvider

function formatLine(splitLine) {
  return {
    file: splitLine[1],
    line: splitLine[2],
    column: splitLine[3],
    result: splitLine[4]
  }
}

function openLink(fileName, line) {
  var params = {
    fileName: fileName,
    line: line
  }
  return encodeURI('command:searchy.openFile?' + JSON.stringify(params))
}

function runCommandSync(cmd) {
  let cleanedCommand = processCommand(cmd)
  return execSync(`${rgPath} --glob="!.git" --smart-case --line-number --column --hidden -e ${cleanedCommand}`, execOpts)
}
