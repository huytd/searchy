const vscode = require('vscode')
const querystring = require('querystring')
const rgPath = require('vscode-ripgrep').rgPath
const {
  execSync
} = require('child_process')

const rootPath = vscode.workspace.rootPath

const execOpts = {
  cwd: rootPath,
  maxBuffer: 1024 * 1000
}

class SearchyProvider {
  constructor() {
    this.links = []
  }

  static get scheme() {
    return 'searchy'
  }

  onDidChange() {}

  provideTextDocumentContent(uri) {
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
        this.createDocumentLink(searchResult, lineNumber, cmd)
        return `  ${searchResult.line}: ${searchResult.result}`
      }).join('\n')
      lineNumber += 1
      return `
file://${rootPath}/${fileName}
${resultsForFile}`
    })
    let header = [`${resultsArray.length} search results found`]
    let content = header.concat(lines)

    return content.join('\n')
  }

  provideDocumentLinks(document, token) {
    return this.links
  }

  createDocumentLink(formattedLine, lineNumber, cmd) {
    const {
      file,
      line,
      column
    } = formattedLine
    const col = parseInt(column, 10)
    const preamble = `  ${line}:`.length
    const searchTerm = cmd.length
    const linkRange = new vscode.Range(
      lineNumber,
      preamble + col,
      lineNumber,
      preamble + col + searchTerm
    )
    const uri = vscode.Uri.parse(`file://${rootPath}/${file}`)
    const linkTarget = uri.with({
      fragment: String(line)
    })
    this.links.push(new vscode.DocumentLink(linkRange, linkTarget))
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
  return execSync(`${rgPath} --case-sensitive --line-number --column ${cmd}`, execOpts)
}
