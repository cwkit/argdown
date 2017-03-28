import * as _ from 'lodash';
import {Statement} from '../model/Statement.js';
import {Argument} from '../model/Argument.js';
import {EquivalenceClass} from '../model/EquivalenceClass.js';
import {tokenMatcher} from 'chevrotain';
import {ArgdownLexer} from './../ArgdownLexer.js';

class ArgdownPreprocessor{
  run(result){
    result.statements = this.statements;
    result.arguments = this.arguments;
    return result;
  }
  constructor(){
    this.name = "ArgdownPreprocessor";
    let $ = this;

    const statementReferencePattern = /\[(.+)\]/;
    const statementDefinitionPattern = /\[(.+)\]\:/;
    const statementMentionPattern = /\@\[(.+)\](\s?)/;
    const argumentReferencePattern = /\<(.+)\>/;
    const argumentDefinitionPattern = /\<(.+)\>\:/;
    const argumentMentionPattern = /\@\<(.+)\>(\s?)/;
    const linkPattern = /\[(.+)\]\((.+)\)/;

    let uniqueTitleCounter = 0;
    function getUniqueTitle(){
      uniqueTitleCounter++;
      return "Untitled "+uniqueTitleCounter;
    }
    function getEquivalenceClass(title){
      if(!title)
        return null;

      let ec = $.statements[title];
      if(!ec){
        ec = new EquivalenceClass();
        ec.title = title;
        $.statements[title] = ec;
      }
      return ec;
    }


    let currentStatement = null;
    let currentStatementOrArgument = null;
    let currentArgument = null;
    let currentArgumentReconstruction = null;
    let currentInference = null;
    let rangesStack = [];
    let parentsStack = [];
    let currentRelation = null;

    function onArgdownEntry(){
      $.statements = {};
      $.arguments = {};
      currentStatement = null;
      currentStatementOrArgument = null;
      currentArgumentReconstruction = null;
      currentInference = null;
      currentArgument = null;
      rangesStack = [];
      parentsStack = [];
      currentRelation = null;
    }
    function onStatementEntry(node, parentNode){
      currentStatement = new Statement();
      if(parentNode.name == 'argdown'){
          currentStatement.role = "thesis";
      }
      currentStatementOrArgument = currentStatement;
      node.statement = currentStatement;
    }
    function onStatementExit(node){
      let statement = node.statement;
      if(!statement.title || statement.title == ''){
        statement.title = getUniqueTitle();
      }
      let equivalenceClass = getEquivalenceClass(statement.title);
      equivalenceClass.members.push(statement);
      if(statement.role == "thesis"){
        equivalenceClass.isUsedAsThesis = true; //members are used outside of argument reconstructions (not as premise or conclusion)
      }
      currentStatement = null;
    }
    function onStatementDefinitionEntry(node){
      let match = statementDefinitionPattern.exec(node.image);
      if(match != null){
        currentStatement.title = match[1];
        node.statement = currentStatement;
      }
    }
    function onStatementReferenceEntry(node){
      let match = statementReferencePattern.exec(node.image);
      if(match != null){
        currentStatement.title = match[1];
        node.statement = currentStatement;
      }
    }
    function onStatementMentionExit(node){
      let match = statementMentionPattern.exec(node.image);
      if(match){
        node.title = match[1];
        if(node.image[node.image.length - 1] == " "){
          node.trailingWhitespace = ' ';
        }else {
          node.trailingWhitespace = '';
        }
        if(currentStatement){
          let range = {type:'statement-mention',title:node.title, start:currentStatement.text.length};
          currentStatement.text += node.image;
          range.stop = currentStatement.text.length -1;
          currentStatement.ranges.push(range);
        }
      }
    }
    function updateArgument(title){
      currentArgument = $.arguments[title];
      if(!currentArgument){
        currentArgument = new Argument();
        currentStatementOrArgument = currentArgument;
        currentArgument.title = title;
        //we are in the ArgumentDefinition token, parentNode is the argumentDefinition rule
        $.arguments[currentArgument.title] = currentArgument;
      }
      currentStatement = new Statement();
      currentArgument.descriptions.push(currentStatement);
    }
    function onArgumentDefinitionEntry(node, parentNode){
      let match = argumentDefinitionPattern.exec(node.image);
      if(match != null){
        let title = match[1];
        updateArgument(title);
        parentNode.argument = currentArgument;
      }
    }
    function onArgumentDefinitionOrReferenceExit(){
      currentStatement = null;
      currentArgument = null;
    }
    function onArgumentReferenceEntry(node, parentNode){
      let match = argumentReferencePattern.exec(node.image);
      if(match != null){
        let title = match[1];
        updateArgument(title);
        parentNode.argument = currentArgument;
      }
    }
    function onArgumentMentionExit(node){
      let match = argumentMentionPattern.exec(node.image);
      if(match){
        node.title = match[1];
        if(node.image[node.image.length - 1] == " "){
          node.trailingWhitespace = ' ';
        }else {
          node.trailingWhitespace = '';
        }
        if(currentStatement){
          let range = {type:'argument-mention',title:node.title, start:currentStatement.text.length};
          currentStatement.text += node.image;
          range.stop = currentStatement.text.length -1;
          currentStatement.ranges.push(range);
        }
      }
    }
    function onFreestyleTextEntry(node){
      node.text = "";
      for(let child of node.children){
        node.text += child.image;
      }
      if(currentStatement)
        currentStatement.text += node.text;
    }
    function onLinkEntry(node){
      let match = linkPattern.exec(node.image);
      let linkRange = {type:'link', start: currentStatement.text.length};
      node.url = match[2];
      node.text = match[1];
      currentStatement.text += node.text;
      linkRange.stop = currentStatement.text.length - 1;
      linkRange.url = node.url;
      currentStatement.ranges.push(linkRange);
      if(node.image[node.image.length - 1] == ' '){
        currentStatement.text += ' ';
        node.trailingWhitespace = ' ';
      }else{
        node.trailingWhitespace = '';
      }
    }

    function onBoldEntry(){
      let boldRange = {type:'bold', start: currentStatement.text.length};
      rangesStack.push(boldRange);
      currentStatement.ranges.push(boldRange);
    }
    function onBoldExit(node){
      let boldEnd = _.last(node.children);
      if(boldEnd.image[boldEnd.image.length - 1] == ' '){
        currentStatement.text += ' ';
        node.trailingWhitespace = ' ';
      }else{
        node.trailingWhitespace = '';
      }
      let range = _.last(rangesStack);
      range.stop = currentStatement.text.length - 1;
      rangesStack.pop();
    }
    function onItalicEntry(){
      let italicRange = {type:'italic', start: currentStatement.text.length};
      rangesStack.push(italicRange);
      currentStatement.ranges.push(italicRange);
    }
    function onItalicExit(node){
      let italicEnd = _.last(node.children);
      if(italicEnd.image[italicEnd.image.length - 1] == ' '){
        currentStatement.text += ' ';
        node.trailingWhitespace = ' ';
      }else{
        node.trailingWhitespace = '';
      }
      let range = _.last(rangesStack);
      range.stop = currentStatement.text.length - 1;
      rangesStack.pop();
    }

    function onRelationExit(node){
      let relation = node.relation;
      let contentNode = node.children[1];
      let content = contentNode.argument ||contentNode.statement;
      let target = getRelationTarget(content);
      if(relation){
        if(relation.from)
          relation.to = target;
        else {
          relation.from = target;
        }
        relation.from.relations.push(relation);
        relation.to.relations.push(relation);
      }
    }
    function onIncomingSupportEntry(node){
      let target = _.last(parentsStack);
      currentRelation = {type:"support", from:target};
      node.relation = currentRelation;
    }
    function onIncomingAttackEntry(node){
      let target = _.last(parentsStack);
      currentRelation = {type:"attack", from:target};
      node.relation = currentRelation;
    }
    function onOutgoingSupportEntry(node){
      let target = _.last(parentsStack);
      currentRelation = {type:"support", to:target};
      node.relation = currentRelation;
    }
    function onOutgoingAttackEntry(node){
      let target = _.last(parentsStack);
      currentRelation = {type:"attack", to:target};
      node.relation = currentRelation;
    }
    function onRelationsEntry(){
      parentsStack.push(getRelationTarget(currentStatementOrArgument));
    }
    function getRelationTarget(statementOrArgument){
      let target = statementOrArgument;
      if(statementOrArgument instanceof Statement){
        if(!statementOrArgument.title)
          statementOrArgument.title = getUniqueTitle();
        target = getEquivalenceClass(statementOrArgument.title);
      }
      return target;
    }
    function onRelationsExit(){
      currentRelation = null;
      parentsStack.pop();
    }

    function onArgumentEntry(node, parentNode, childIndex){
      let argument = null;
      if(childIndex > 0){
          let precedingSibling = parentNode.children[childIndex - 1];
          if(precedingSibling.name == 'argumentReference' || precedingSibling.name == 'argumentDefinition'){
            argument = precedingSibling.argument;
          }else if(tokenMatcher(precedingSibling, ArgdownLexer.Emptyline)){
            precedingSibling = parentNode.children[childIndex - 2];
            if(precedingSibling.name == 'argumentReference' || precedingSibling.name == 'argumentDefinition'){
              argument = precedingSibling.argument;
            }
          }
        }
        if(!argument){
          argument = new Argument();
          argument.title = getUniqueTitle();
          $.arguments[argument.title] = argument;
        }
        node.argument = argument;
        currentArgumentReconstruction = argument;
    }
    function onArgumentStatementExit(node, parentNode, childIndex){
      if(node.children.length > 1){
        //first node is ArgdownLexer.ArgumentStatementStart
        let statementNode = node.children[1];
        let statement = statementNode.statement;
        statement.role = "premise";
        if(childIndex > 0){
          let precedingSibling = parentNode.children[childIndex - 1];
          if(precedingSibling.name == 'inference'){
            statement.role = "conclusion";
            statement.inference = precedingSibling.inference;
          }
        }
        let ec = getEquivalenceClass(statement.title);
        ec.isUsedInArgument = true;
        currentArgumentReconstruction.pcs.push(statement);
        node.statement = statement;
        node.statementNr = currentArgumentReconstruction.pcs.length;
      }
    }
    function onInferenceEntry(node){
      currentInference = {inferenceRules:[], metaData:{}};
      node.inference = currentInference;
    }
    function onInferenceRulesExit(node){
      for(let child of node.children){
        if(child.name == 'freestyleText'){
          currentInference.inferenceRules.push(child.text.trim());
        }
      }
    }
    function onMetadataStatementExit(node){
      let key = node.children[0].text;
      let value = null;
      if(node.children.length == 2){
        value = node.children[1].text;
      }else{
        value = [];
        for(let i = 1; i < node.children.length; i++){
          value.push(node.children[i].text);
        }
      }
      currentInference.metaData[key] = value;
    }
    function onHeadingExit(node){
      let headingStart = node.children[0];
      node.heading = headingStart.image.length;
      node.text = node.children[1].text;
    }

    this.argdownListeners = {
      argdownEntry : onArgdownEntry,
      headingExit : onHeadingExit,
      statementEntry : onStatementEntry,
      statementExit : onStatementExit,
      argumentEntry : onArgumentEntry,
      argumentStatementExit : onArgumentStatementExit,
      inferenceEntry : onInferenceEntry,
      inferenceRulesExit : onInferenceRulesExit,
      metadataStatementExit : onMetadataStatementExit,
      StatementDefinitionEntry : onStatementDefinitionEntry,
      StatementReferenceEntry : onStatementReferenceEntry,
      StatementMentionExit : onStatementMentionExit,
      ArgumentDefinitionEntry : onArgumentDefinitionEntry,
      ArgumentReferenceEntry : onArgumentReferenceEntry,
      ArgumentMentionExit : onArgumentMentionExit,
      argumentDefinitionExit : onArgumentDefinitionOrReferenceExit,
      argumentReferenceExit : onArgumentDefinitionOrReferenceExit,
      incomingSupportEntry : onIncomingSupportEntry,
      incomingSupportExit : onRelationExit,
      incomingAttackEntry : onIncomingAttackEntry,
      incomingAttackExit : onRelationExit,
      outgoingSupportEntry : onOutgoingSupportEntry,
      outgoingSupportExit : onRelationExit,
      outgoingAttackEntry : onOutgoingAttackEntry,
      outgoingAttackExit : onRelationExit,
      relationsEntry : onRelationsEntry,
      relationsExist : onRelationsExit,
      freestyleTextEntry : onFreestyleTextEntry,
      italicEntry : onItalicEntry,
      italicExit : onItalicExit,
      boldEntry : onBoldEntry,
      boldExit : onBoldExit,
      LinkEntry : onLinkEntry
    }
  }
  logRelations(data){
    for(let statementKey of Object.keys(data.statements)){
      let statement = data.statements[statementKey];
      for(let relation of statement.relations){
        if(relation.from == statement){
          console.log("Relation from: "+relation.from.title+" to: "+relation.to.title+" type: "+relation.type);
        }
      }
    }
    for(let argumentKey of Object.keys(data.arguments)){
      let argument = data.arguments[argumentKey];
      for(let relation of argument.relations){
        if(relation.from == argument){
          console.log("Relation from: "+relation.from.title+" to: "+relation.to.title+" type: "+relation.type);
        }
      }
    }
  }
}
module.exports = {
  ArgdownPreprocessor: ArgdownPreprocessor
}